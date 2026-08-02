'use strict';

const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const db = require('./db');
const redis = require('./redis');
const { JWT_SECRET } = require('../config/env');

const wsClients = new Map();
let wss = null;

const LATEST_APP_UPDATE = {
  versionCode: 3,
  versionName: "1.0.3",
  apkPath: "/uploads/imutflix.apk",
  changelog: "Fix pemutar media",
  forceUpdate: true
};

function broadcastToUser(userId, payload) {
  if (!userId) return;
  const uidStr = userId.toString();
  const userSockets = wsClients.get(uidStr);
  if (userSockets) {
    const message = JSON.stringify(payload);
    userSockets.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }
}

function initWebSocket(server) {
  wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    try {
      const reqUrl = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      if (reqUrl.pathname === '/ws') {
        const token = reqUrl.searchParams.get('token');
        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        jwt.verify(token, JWT_SECRET, (err, decoded) => {
          if (err) {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
          }
          wss.handleUpgrade(request, socket, head, (ws) => {
            ws.user = decoded;
            wss.emit('connection', ws, request);
          });
        });
      } else {
        socket.destroy();
      }
    } catch (e) {
      socket.destroy();
    }
  });

  wss.on('connection', (ws, request) => {
    const userId = ws.user?.id?.toString();
    if (!userId) return;

    if (!wsClients.has(userId)) {
      wsClients.set(userId, new Set());
    }
    wsClients.get(userId).add(ws);
    console.log(`[WebSocket] Client connected for userId: ${userId}`);

    // Send latest app update info
    try {
      const host = request?.headers?.host || `localhost:${process.env.PORT || 3000}`;
      ws.send(JSON.stringify({
        type: 'APP_UPDATE_AVAILABLE',
        data: {
          versionCode: LATEST_APP_UPDATE.versionCode,
          versionName: LATEST_APP_UPDATE.versionName,
          apkUrl: `http://${host}${LATEST_APP_UPDATE.apkPath}`,
          changelog: LATEST_APP_UPDATE.changelog,
          forceUpdate: LATEST_APP_UPDATE.forceUpdate
        }
      }));
    } catch (err) {
      console.error('Failed to send WebSocket update check:', err.message);
    }

    ws.on('message', async (message) => {
      try {
        const payload = JSON.parse(message.toString());
        const { type, data } = payload;

        if (type === 'SAVE_PROGRESS' && data) {
          const {
            mediaId, mediaType, season = 1, episode = 1, positionMs, durationMs,
            title, posterPath, backdropPath, rating, releaseYear, originalTitle, overview
          } = data;

          if (mediaId && mediaType && positionMs !== undefined && durationMs !== undefined) {
            console.log(`[WebSocket LOG] SAVE_PROGRESS for user ${userId} -> ${title || mediaId} (${positionMs}/${durationMs}ms)`);

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
          }
        } else if (type === 'ADD_WATCHLIST' && data) {
          const { mediaId, mediaType, title, posterPath, backdropPath, rating, releaseYear, originalTitle, overview } = data;
          if (mediaId && mediaType && title) {
            console.log(`[WebSocket LOG] ADD_WATCHLIST for user ${userId} -> ${title}`);
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
          }
        } else if (type === 'REMOVE_WATCHLIST' && data) {
          const { mediaId, mediaType } = data;
          if (mediaId && mediaType) {
            console.log(`[WebSocket LOG] REMOVE_WATCHLIST for user ${userId} -> ${mediaId}`);
            await db.query(
              'DELETE FROM watchlist WHERE user_id = $1 AND media_id = $2 AND media_type = $3',
              [userId, mediaId, mediaType]
            );

            broadcastToUser(userId, {
              type: 'WATCHLIST_UPDATED',
              action: 'REMOVE',
              data: { mediaId, mediaType }
            });
          }
        }
      } catch (err) {
        console.error('WebSocket message processing error:', err.message);
      }
    });

    ws.on('close', () => {
      if (wsClients.has(userId)) {
        wsClients.get(userId).delete(ws);
        if (wsClients.get(userId).size === 0) {
          wsClients.delete(userId);
        }
      }
      console.log(`[WebSocket] Client disconnected for userId: ${userId}`);
    });
  });
}

module.exports = {
  initWebSocket,
  broadcastToUser
};
