'use strict';

const db = require('../lib/db');
const tmdb = require('../lib/tmdb');
const s3 = require('../lib/s3');
const { getGDriveClient } = require('../lib/gdrive');

// Helper to generate standardized slug from title (matching android's buildSlugCandidates)
function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[:\-–—;]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .trim('-');
}

/**
 * Endpoint: GET /search?q=query&maxResult=5
 */
exports.search = async (req, res, next) => {
  try {
    const q = req.query.q || '';
    const maxResult = parseInt(req.query.maxResult || '5', 10);
    
    if (q.trim().length < 2) {
      return res.json({ result: [], length: "0" });
    }

    // Search available media in our database
    const dbRes = await db.query(
      `SELECT * FROM media_items 
       WHERE title ILIKE $1 OR slug ILIKE $1 
       LIMIT $2`,
      [`%${q}%`, maxResult]
    );

    const result = [];
    for (const row of dbRes.rows) {
      const isTv = row.media_type === 'tv' || row.media_type === 'series';
      
      // Fetch rich metadata from TMDB
      let tmdbData = null;
      if (isTv) {
        tmdbData = await tmdb.getTvDetail(row.tmdb_id);
      } else {
        tmdbData = await tmdb.getMovieDetail(row.tmdb_id);
      }

      if (tmdbData) {
        result.push({
          title: row.title,
          slug: row.slug,
          type: isTv ? 'tvshows' : 'movie',
          rating: tmdbData.vote_average ? String(tmdbData.vote_average) : null,
          quality: 'HD',
          thumbnailPotrait: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w300${tmdbData.poster_path}` : null
        });
      }
    }

    res.json({
      result,
      length: String(result.length)
    });
  } catch (err) {
    console.error('[Search Error]:', err.message);
    res.json({ result: [], length: "0", error: err.message });
  }
};

/**
 * Endpoint: GET /play?slug=xxx&type=movie
 * Endpoint: GET /play?slug=xxx&type=tvshows&season=1&ep=1
 */
exports.play = async (req, res, next) => {
  try {
    const { slug, type = 'movie', season = 1, ep = 1 } = req.query;
    if (!slug) return res.status(400).json({ error: 'slug is required' });

    const isTv = type === 'tvshows' || type === 'series' || type === 'tv';
    const mediaType = isTv ? 'tv' : 'movie';

    // 1. Resolve slug to media item from DB
    const mediaRes = await db.query(
      `SELECT * FROM media_items 
       WHERE (slug = $1 OR slug LIKE $1 || '-%') 
         AND media_type = $2 
       LIMIT 1`,
      [slug, mediaType]
    );

    if (mediaRes.rows.length === 0) {
      return res.status(404).json({ error: 'Media not found in local database' });
    }

    const mediaItem = mediaRes.rows[0];

    // 2. Fetch video file from DB
    let fileRes;
    if (isTv) {
      fileRes = await db.query(
        `SELECT * FROM video_files 
         WHERE media_item_id = $1 AND season = $2 AND episode = $3`,
        [mediaItem.id, Number(season), Number(ep)]
      );
    } else {
      fileRes = await db.query(
        `SELECT * FROM video_files 
         WHERE media_item_id = $1`,
        [mediaItem.id]
      );
    }

    if (fileRes.rows.length === 0) {
      return res.status(404).json({ error: 'Stream file not found for this media/episode' });
    }

    const videoFile = fileRes.rows[0];

    // 3. Generate stream URL based on storage provider
    if (videoFile.storage_provider === 'gdrive') {
      const host = req.headers.host || 'localhost:3001';
      const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const streamUrl = `${protocol}://${host}/play/drive/${videoFile.s3_key}`;

      return res.json({
        m3u8: streamUrl,
        embedUrl: null,
        pageUrl: null,
        subtitleUrl: null
      });
    }

    // Fallback S3
    const streamUrl = await s3.getPresignedStreamUrl(videoFile.s3_key, videoFile.storage_provider || 'r2');
    if (!streamUrl) {
      return res.status(500).json({ error: 'Failed to generate stream link from S3' });
    }

    // 4. Optionally fetch subtitle from TMDB or return null (ExoPlayer plays softsubs)
    res.json({
      m3u8: streamUrl, // ExoPlayer can stream mkv/mp4 direct from signed URL
      embedUrl: null,
      pageUrl: null,
      subtitleUrl: null
    });
  } catch (err) {
    console.error('[Play Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Endpoint: GET /play/lk21?title=xxx&type=movie&season=1&ep=1&year=2021 (Fallback play endpoint)
 */
exports.playLk21 = async (req, res, next) => {
  try {
    const { title, type = 'movie', season = 1, ep = 1 } = req.query;
    if (!title) return res.status(400).json({ error: 'title is required' });

    // Try resolving by slug generated from title
    const slug = generateSlug(title);
    req.query.slug = slug;
    
    return exports.play(req, res, next);
  } catch (err) {
    console.error('[PlayLk21 Error]:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * Endpoint: GET /api/episodes/available?slug=xxx&type=tvshows
 */
exports.getAvailableEpisodes = async (req, res, next) => {
  try {
    const { slug, type = 'tvshows' } = req.query;
    if (!slug) return res.status(400).json({ error: 'slug is required' });

    const isTv = type === 'tvshows' || type === 'series' || type === 'tv';
    const mediaType = isTv ? 'tv' : 'movie';

    // 1. Resolve slug to media item
    const mediaRes = await db.query(
      `SELECT * FROM media_items 
       WHERE (slug = $1 OR slug LIKE $1 || '-%') 
         AND media_type = $2 
       LIMIT 1`,
      [slug, mediaType]
    );

    if (mediaRes.rows.length === 0) {
      return res.json({ isAvailable: false, type, seasons: [], sources: ['s3'] });
    }

    const mediaItem = mediaRes.rows[0];

    // If movie, it's available
    if (!isTv) {
      return res.json({
        isAvailable: true,
        type: 'movie',
        seasons: [],
        sources: ['s3']
      });
    }

    // 2. Fetch all available episodes for this tv show
    const filesRes = await db.query(
      `SELECT season, episode FROM video_files 
       WHERE media_item_id = $1 
       ORDER BY season, episode`,
      [mediaItem.id]
    );

    // Group episodes by season
    const seasonsMap = {};
    for (const row of filesRes.rows) {
      if (!seasonsMap[row.season]) {
        seasonsMap[row.season] = [];
      }
      seasonsMap[row.season].push(row.episode);
    }

    const seasons = Object.keys(seasonsMap).map(seasonNum => {
      const eps = seasonsMap[seasonNum].sort((a, b) => a - b);
      return {
        seasonNumber: Number(seasonNum),
        episodeCount: eps.length,
        episodes: eps
      };
    });

    res.json({
      isAvailable: seasons.length > 0,
      type: 'tvshows',
      seasons,
      sources: ['s3']
    });
  } catch (err) {
    console.error('[Available Episodes Error]:', err.message);
    res.json({ isAvailable: false, type: 'tvshows', seasons: [], sources: ['s3'], error: err.message });
  }
};

exports.streamFromDrive = async (req, res, next) => {
  const { fileId } = req.params;
  const range = req.headers.range;

  try {
    const oAuth2Client = await getGDriveClient();
    if (!oAuth2Client) {
      return res.status(503).json({ error: 'Google Drive authentication files are missing on server.' });
    }

    // 1. Get file metadata (size, mimeType)
    const metadataUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?fields=size,mimeType`;
    const metadataRes = await oAuth2Client.request({
      url: metadataUrl,
      method: 'GET'
    });

    const fileSize = parseInt(metadataRes.data.size, 10);
    const mimeType = metadataRes.data.mimeType || 'video/mp4';

    // 2. Prepare range request piping
    const driveUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
    let driveRequestHeaders = {};

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mimeType,
      });

      driveRequestHeaders['Range'] = `bytes=${start}-${end}`;
    } else {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
      });
    }

    // 3. Pipe Google API stream response
    const response = await oAuth2Client.request({
      url: driveUrl,
      method: 'GET',
      headers: driveRequestHeaders,
      responseType: 'stream'
    });

    response.data.pipe(res);

    // Stop pipeline if client aborts the request (seeking or closing the player)
    req.on('close', () => {
      if (response.data && typeof response.data.destroy === 'function') {
        response.data.destroy();
      }
    });

  } catch (err) {
    console.error(`[GDrive Stream Error] Failed streaming file "${fileId}":`, err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: `Gagal memutar stream Google Drive: ${err.message}` });
    }
  }
};

/**
 * Endpoints for Browse / Detail pages (For compatibility / Swagger docs)
 */
exports.featured = async (req, res, next) => {
  try {
    const dbRes = await db.query('SELECT * FROM media_items ORDER BY created_at DESC LIMIT 10');
    const result = [];
    for (const row of dbRes.rows) {
      const isTv = row.media_type === 'tv';
      const tmdbData = isTv ? await tmdb.getTvDetail(row.tmdb_id) : await tmdb.getMovieDetail(row.tmdb_id);
      if (tmdbData) {
        result.push({
          title: row.title,
          slug: row.slug,
          year: row.created_at.getFullYear(),
          type: isTv ? 'series' : 'movie',
          rating: tmdbData.vote_average,
          poster: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w300${tmdbData.poster_path}` : null,
          quality: 'HD',
          link: {
            endpoint: `${isTv ? 'series' : 'movie'}/${row.slug}`,
            thumbnail: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w300${tmdbData.poster_path}` : null
          }
        });
      }
    }
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.cinemaxxi = exports.featured; // Use same for recently added

exports.home = async (req, res, next) => {
  try {
    const dbRes = await db.query('SELECT * FROM media_items ORDER BY created_at DESC LIMIT 20');
    const result = [];
    for (const row of dbRes.rows) {
      const isTv = row.media_type === 'tv';
      const tmdbData = isTv ? await tmdb.getTvDetail(row.tmdb_id) : await tmdb.getMovieDetail(row.tmdb_id);
      if (tmdbData) {
        result.push({
          title: row.title,
          slug: row.slug,
          type: isTv ? 'series' : 'movie',
          poster: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w300${tmdbData.poster_path}` : null,
          rating: tmdbData.vote_average,
          quality: 'HD'
        });
      }
    }
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.homeSections = async (req, res, next) => {
  try {
    const dbRes = await db.query('SELECT * FROM media_items ORDER BY created_at DESC LIMIT 20');
    const movies = [];
    const series = [];
    for (const row of dbRes.rows) {
      const isTv = row.media_type === 'tv';
      const tmdbData = isTv ? await tmdb.getTvDetail(row.tmdb_id) : await tmdb.getMovieDetail(row.tmdb_id);
      if (tmdbData) {
        const item = {
          title: row.title,
          slug: row.slug,
          type: isTv ? 'series' : 'movie',
          poster: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w300${tmdbData.poster_path}` : null,
          rating: tmdbData.vote_average,
          quality: 'HD'
        };
        if (isTv) series.push(item);
        else movies.push(item);
      }
    }
    res.json({
      success: true,
      data: [
        { sectionTitle: 'Rekomendasi Film S3', items: movies },
        { sectionTitle: 'Serial TV Terbaru', items: series }
      ]
    });
  } catch (err) {
    next(err);
  }
};

exports.browseMovies = async (req, res, next) => {
  try {
    const dbRes = await db.query("SELECT * FROM media_items WHERE media_type = 'movie' ORDER BY created_at DESC");
    const result = [];
    for (const row of dbRes.rows) {
      const tmdbData = await tmdb.getMovieDetail(row.tmdb_id);
      if (tmdbData) {
        result.push({
          title: row.title,
          slug: row.slug,
          type: 'movie',
          poster: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w300${tmdbData.poster_path}` : null,
          rating: tmdbData.vote_average,
          quality: 'HD'
        });
      }
    }
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.browseSeries = async (req, res, next) => {
  try {
    const dbRes = await db.query("SELECT * FROM media_items WHERE media_type = 'tv' ORDER BY created_at DESC");
    const result = [];
    for (const row of dbRes.rows) {
      const tmdbData = await tmdb.getTvDetail(row.tmdb_id);
      if (tmdbData) {
        result.push({
          title: row.title,
          slug: row.slug,
          type: 'series',
          poster: tmdbData.poster_path ? `https://image.tmdb.org/t/p/w300${tmdbData.poster_path}` : null,
          rating: tmdbData.vote_average,
          quality: 'HD'
        });
      }
    }
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
};

exports.movieDetail = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const dbRes = await db.query("SELECT tmdb_id FROM media_items WHERE slug = $1 AND media_type = 'movie' LIMIT 1", [slug]);
    if (dbRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Movie not found in local DB' });
    }
    const tmdbId = dbRes.rows[0].tmdb_id;
    const tmdbRaw = await tmdb.getMovieDetail(tmdbId);
    if (!tmdbRaw) {
      return res.status(404).json({ success: false, message: 'Metadata not found in TMDB' });
    }
    const data = tmdb.mapMovieDetail(tmdbRaw, slug);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.seriesDetail = async (req, res, next) => {
  try {
    const { slug } = req.params;
    const dbRes = await db.query("SELECT tmdb_id FROM media_items WHERE slug = $1 AND media_type = 'tv' LIMIT 1", [slug]);
    if (dbRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Series not found in local DB' });
    }
    const tmdbId = dbRes.rows[0].tmdb_id;
    const tmdbRaw = await tmdb.getTvDetail(tmdbId);
    if (!tmdbRaw) {
      return res.status(404).json({ success: false, message: 'Metadata not found in TMDB' });
    }
    const data = tmdb.mapTvDetail(tmdbRaw, slug);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

exports.movieStream = async (req, res, next) => {
  try {
    req.query.slug = req.params.slug;
    req.query.type = 'movie';
    return exports.play(req, res, next);
  } catch (err) {
    next(err);
  }
};

exports.seriesStream = async (req, res, next) => {
  try {
    req.query.slug = req.params.slug;
    req.query.type = 'tvshows';
    req.query.season = 1;
    req.query.ep = 1;
    return exports.play(req, res, next);
  } catch (err) {
    next(err);
  }
};

exports.episodeStream = async (req, res, next) => {
  try {
    req.query.slug = req.params.slug;
    req.query.type = 'tvshows';
    req.query.season = req.params.season;
    req.query.ep = req.params.episode;
    return exports.play(req, res, next);
  } catch (err) {
    next(err);
  }
};

// ── TMDB Mock Proxy for Android Client (Dashboard containment) ──

exports.mockTrending = async (req, res, next) => {
  try {
    const dbRes = await db.query('SELECT * FROM media_items ORDER BY created_at DESC LIMIT 20');
    const results = [];
    for (const row of dbRes.rows) {
      const isTv = row.media_type === 'tv' || row.media_type === 'series';
      const tmdbData = isTv ? await tmdb.getTvDetail(row.tmdb_id) : await tmdb.getMovieDetail(row.tmdb_id);
      if (tmdbData) {
        tmdbData.media_type = isTv ? 'tv' : 'movie';
        results.push(tmdbData);
      }
    }
    res.json({ page: 1, results, total_pages: 1, total_results: results.length });
  } catch (err) {
    next(err);
  }
};

exports.mockMovies = async (req, res, next) => {
  try {
    const dbRes = await db.query("SELECT * FROM media_items WHERE media_type = 'movie' ORDER BY created_at DESC LIMIT 20");
    const results = [];
    for (const row of dbRes.rows) {
      const tmdbData = await tmdb.getMovieDetail(row.tmdb_id);
      if (tmdbData) {
        results.push(tmdbData);
      }
    }
    res.json({ page: 1, results, total_pages: 1, total_results: results.length });
  } catch (err) {
    next(err);
  }
};

exports.mockTv = async (req, res, next) => {
  try {
    const dbRes = await db.query("SELECT * FROM media_items WHERE media_type = 'tv' OR media_type = 'series' ORDER BY created_at DESC LIMIT 20");
    const results = [];
    for (const row of dbRes.rows) {
      const tmdbData = await tmdb.getTvDetail(row.tmdb_id);
      if (tmdbData) {
        results.push(tmdbData);
      }
    }
    res.json({ page: 1, results, total_pages: 1, total_results: results.length });
  } catch (err) {
    next(err);
  }
};

exports.mockSearch = async (req, res, next) => {
  try {
    const query = req.query.query || '';
    if (!query.trim()) {
      return res.json({ page: 1, results: [], total_pages: 1, total_results: 0 });
    }
    const dbRes = await db.query(
      `SELECT * FROM media_items WHERE title ILIKE $1 OR slug ILIKE $1 LIMIT 10`,
      [`%${query}%`]
    );
    const results = [];
    for (const row of dbRes.rows) {
      const isTv = row.media_type === 'tv' || row.media_type === 'series';
      const tmdbData = isTv ? await tmdb.getTvDetail(row.tmdb_id) : await tmdb.getMovieDetail(row.tmdb_id);
      if (tmdbData) {
        tmdbData.media_type = isTv ? 'tv' : 'movie';
        results.push(tmdbData);
      }
    }
    res.json({ page: 1, results, total_pages: 1, total_results: results.length });
  } catch (err) {
    next(err);
  }
};

exports.proxyMovieDetail = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const tmdbData = await tmdb.getMovieDetail(id);
    if (!tmdbData) return res.status(404).json({ error: 'Movie not found in TMDB' });
    res.json(tmdbData);
  } catch (err) {
    next(err);
  }
};

exports.proxyTvDetail = async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const tmdbData = await tmdb.getTvDetail(id);
    if (!tmdbData) return res.status(404).json({ error: 'TV show not found in TMDB' });
    res.json(tmdbData);
  } catch (err) {
    next(err);
  }
};
