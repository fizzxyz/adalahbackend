'use strict';

const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const db = require('../lib/db');
const redis = require('../lib/redis');
const { broadcastToUser } = require('../lib/websocket');
const { JWT_SECRET, GOOGLE_CLIENT_ID } = require('../config/env');

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

exports.loginGoogle = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken is required' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (authErr) {
      console.log('Library verification failed, falling back to Google TokenInfo API...');
      const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
      payload = await googleRes.json();
    }

    const { sub: googleId, email, name, picture } = payload;
    if (!email) return res.status(400).json({ error: 'Email not provided by Google' });

    // Insert/Update User
    let userResult = await db.query(
      'INSERT INTO users (google_id, email, name, picture) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET google_id = $1, name = $3, picture = $4 RETURNING *',
      [googleId, email, name, picture]
    );
    const user = userResult.rows[0];

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, user });
  } catch (err) {
    console.error('Google Auth error:', err.message);
    res.status(500).json({ error: 'Authentication failed', message: err.message });
  }
};

exports.loginMock = async (req, res, next) => {
  try {
    const { email, name, picture = '' } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const mockGoogleId = 'mock_' + Date.now();

    let userResult = await db.query(
      'INSERT INTO users (google_id, email, name, picture) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO UPDATE SET name = $3, picture = $4 RETURNING *',
      [mockGoogleId, email, name || 'Developer User', picture]
    );
    const user = userResult.rows[0];

    const token = jwt.sign(
      { id: user.id, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, user });
  } catch (err) {
    console.error('Mock Auth error:', err.message);
    res.status(500).json({ error: 'Mock authentication failed', message: err.message });
  }
};

exports.saveProgress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      mediaId, mediaType, season = 1, episode = 1, positionMs, durationMs,
      title, posterPath, backdropPath, rating, releaseYear, originalTitle, overview
    } = req.body;

    if (!mediaId || !mediaType || positionMs === undefined || durationMs === undefined) {
      return res.status(400).json({ error: 'mediaId, mediaType, positionMs, and durationMs are required' });
    }

    await db.query(
      `INSERT INTO watch_progress (
          user_id, media_id, media_type, season, episode, position_ms, duration_ms, 
          title, poster_path, backdrop_path, rating, release_year, original_title, overview, updated_at
       ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, CURRENT_TIMESTAMP) 
       ON CONFLICT (user_id, media_id, media_type, season, episode) 
       DO UPDATE SET 
          position_ms = $6, 
          duration_ms = $7, 
          title = COALESCE($8, watch_progress.title), 
          poster_path = COALESCE($9, watch_progress.poster_path),
          backdrop_path = COALESCE($10, watch_progress.backdrop_path),
          rating = COALESCE($11, watch_progress.rating),
          release_year = COALESCE($12, watch_progress.release_year),
          original_title = COALESCE($13, watch_progress.original_title),
          overview = COALESCE($14, watch_progress.overview),
          updated_at = CURRENT_TIMESTAMP`,
      [
        userId, mediaId, mediaType, season, episode, positionMs, durationMs,
        title || null, posterPath || null, backdropPath || null, rating || null,
        releaseYear || null, originalTitle || null, overview || null
      ]
    );

    const cacheKey = `progress:${userId}:${mediaId}:${mediaType}:${season}:${episode}`;
    const cacheValue = JSON.stringify({
      positionMs, durationMs, title, posterPath, backdropPath,
      rating, releaseYear, originalTitle, overview, updatedAt: new Date()
    });
    await redis.setEx(cacheKey, 30 * 24 * 60 * 60, cacheValue);

    broadcastToUser(userId, {
      type: 'WATCH_PROGRESS_UPDATED',
      data: { mediaId, mediaType, season, episode, positionMs, durationMs, title }
    });

    res.json({ success: true, message: 'Watch progress saved' });
  } catch (err) {
    console.error('Save progress error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getAllWatchProgress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT DISTINCT ON (media_id, media_type)
              media_id as "mediaId", media_type as "mediaType", season, episode, 
              position_ms as "positionMs", duration_ms as "durationMs", title, 
              poster_path as "posterPath", backdrop_path as "backdropPath", 
              rating, release_year as "releaseYear", original_title as "originalTitle", 
              overview, updated_at as "updatedAt"
       FROM watch_progress 
       WHERE user_id = $1 AND position_ms > 0
       ORDER BY media_id, media_type, updated_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get all watch progress error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getWatchProgress = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { mediaId } = req.params;
    const { mediaType, season = 1, episode = 1 } = req.query;

    if (!mediaType) return res.status(400).json({ error: 'mediaType query parameter is required' });

    const cacheKey = `progress:${userId}:${mediaId}:${mediaType}:${season}:${episode}`;
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }

    const result = await db.query(
      `SELECT position_ms as "positionMs", duration_ms as "durationMs", title, 
              poster_path as "posterPath", backdrop_path as "backdropPath", 
              rating, release_year as "releaseYear", original_title as "originalTitle", 
              overview, updated_at as "updatedAt"
       FROM watch_progress 
       WHERE user_id = $1 AND media_id = $2 AND media_type = $3 AND season = $4 AND episode = $5`,
      [userId, mediaId, mediaType, Number(season), Number(episode)]
    );

    if (result.rows.length === 0) {
      return res.json({ positionMs: 0, durationMs: 0 });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get watch progress error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.addToWatchlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { mediaId, mediaType, title, posterPath, backdropPath, rating, releaseYear, originalTitle, overview } = req.body;

    if (!mediaId || !mediaType || !title) {
      return res.status(400).json({ error: 'mediaId, mediaType, and title are required' });
    }

    await db.query(
      `INSERT INTO watchlist (
          user_id, media_id, media_type, title, poster_path, backdrop_path, rating, release_year, original_title, overview
       ) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       ON CONFLICT (user_id, media_id, media_type) 
       DO UPDATE SET 
          title = $4, 
          poster_path = $5,
          backdrop_path = $6,
          rating = $7,
          release_year = $8,
          original_title = $9,
          overview = $10`,
      [userId, mediaId, mediaType, title, posterPath || null, backdropPath || null, rating || null, releaseYear || null, originalTitle || null, overview || null]
    );

    broadcastToUser(userId, {
      type: 'WATCHLIST_UPDATED',
      action: 'ADD',
      data: { mediaId, mediaType, title }
    });

    res.json({ success: true, message: 'Added to watchlist' });
  } catch (err) {
    console.error('Add to watchlist error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.removeFromWatchlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { mediaId } = req.params;
    const { mediaType } = req.query;

    if (!mediaType) return res.status(400).json({ error: 'mediaType query parameter is required' });

    await db.query(
      'DELETE FROM watchlist WHERE user_id = $1 AND media_id = $2 AND media_type = $3',
      [userId, mediaId, mediaType]
    );

    broadcastToUser(userId, {
      type: 'WATCHLIST_UPDATED',
      action: 'REMOVE',
      data: { mediaId, mediaType }
    });

    res.json({ success: true, message: 'Removed from watchlist' });
  } catch (err) {
    console.error('Remove from watchlist error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getWatchlist = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const result = await db.query(
      `SELECT media_id as "mediaId", media_type as "mediaType", title, 
              poster_path as "posterPath", backdrop_path as "backdropPath", 
              rating, release_year as "releaseYear", original_title as "originalTitle", 
              overview, created_at as "createdAt"
       FROM watchlist 
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get watchlist error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

exports.getWatchlistStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { mediaId } = req.params;
    const { mediaType } = req.query;

    if (!mediaType) return res.status(400).json({ error: 'mediaType query parameter is required' });

    const result = await db.query(
      'SELECT id FROM watchlist WHERE user_id = $1 AND media_id = $2 AND media_type = $3',
      [userId, mediaId, mediaType]
    );

    res.json({
      inWatchlist: result.rows.length > 0
    });
  } catch (err) {
    console.error('Get watchlist status error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
