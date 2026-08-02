'use strict';

const db = require('../lib/db');
const { INTERNAL_API_KEY } = require('../config/env');

exports.registerMedia = async (req, res, next) => {
  try {
    // 1. Authenticate using API Key header
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== INTERNAL_API_KEY) {
      return res.status(401).json({ success: false, message: 'Unauthorized API key' });
    }

    const {
      tmdbId, mediaType, title, slug,
      season = null, episode = null,
      s3Key, s3Url, filename
    } = req.body;

    if (!tmdbId || !mediaType || !title || !slug || !s3Key || !s3Url || !filename) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing required fields: tmdbId, mediaType, title, slug, s3Key, s3Url, filename' 
      });
    }

    const formattedMediaType = mediaType.toLowerCase() === 'movie' ? 'movie' : 'tv';
    const parsedTmdbId = parseInt(tmdbId, 10);
    const parsedSeason = season !== null ? parseInt(season, 10) : null;
    const parsedEpisode = episode !== null ? parseInt(episode, 10) : null;

    // 2. Perform database updates
    // Upsert general media item info
    const mediaRes = await db.query(
      `INSERT INTO media_items (tmdb_id, media_type, title, slug)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tmdb_id, media_type) 
       DO UPDATE SET title = $3, slug = $4
       RETURNING id`,
      [parsedTmdbId, formattedMediaType, title, slug]
    );

    const mediaItemId = mediaRes.rows[0].id;

    // Programmatic Upsert for specific video file mapping (to handle NULLs for movie seasons/episodes safely)
    let checkRes;
    if (parsedSeason !== null && parsedEpisode !== null) {
      checkRes = await db.query(
        `SELECT id FROM video_files WHERE media_item_id = $1 AND season = $2 AND episode = $3`,
        [mediaItemId, parsedSeason, parsedEpisode]
      );
    } else {
      checkRes = await db.query(
        `SELECT id FROM video_files WHERE media_item_id = $1 AND season IS NULL AND episode IS NULL`,
        [mediaItemId]
      );
    }

    if (checkRes.rows.length > 0) {
      // Update existing record
      await db.query(
        `UPDATE video_files SET s3_key = $1, s3_url = $2, filename = $3, created_at = CURRENT_TIMESTAMP WHERE id = $4`,
        [s3Key, s3Url, filename, checkRes.rows[0].id]
      );
    } else {
      // Insert new record
      await db.query(
        `INSERT INTO video_files (media_item_id, season, episode, s3_key, s3_url, filename)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [mediaItemId, parsedSeason, parsedEpisode, s3Key, s3Url, filename]
      );
    }

    console.log(`[Internal Register] Successfully registered media: ${title} (${formattedMediaType}) S${parsedSeason}E${parsedEpisode} -> S3: ${s3Key}`);

    res.json({
      success: true,
      message: 'Media successfully registered',
      data: {
        mediaItemId,
        tmdbId: parsedTmdbId,
        mediaType: formattedMediaType,
        title,
        season: parsedSeason,
        episode: parsedEpisode,
        s3Key
      }
    });
  } catch (err) {
    console.error('[Internal Register Error]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};
