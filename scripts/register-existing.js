'use strict';

// Load env variables first
require('dotenv').config();

const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const db = require('../src/lib/db');
const tmdb = require('../src/lib/tmdb');

const s3Client = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: 'auto', // Default region for Cloudflare R2 S3 API compatibility
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});

async function registerExisting() {
  console.log("==================================================");
  console.log("    REGISTRASI OTOMATIS FILE S3 EXIST KE DB       ");
  console.log("==================================================");
  
  try {
    const bucket = process.env.S3_BUCKET || 'imutflix';
    console.log(`Membaca daftar objek dari S3 bucket: ${bucket}...`);
    
    const command = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: 'imutflix/',
    });
    
    const response = await s3Client.send(command);
    const objects = response.Contents || [];
    
    if (objects.length === 0) {
      console.log("ℹ️ Tidak ada objek ditemukan di S3 bucket.");
      process.exit(0);
    }
    
    console.log(`Ditemukan ${objects.length} objek di S3. Memulai pemrosesan...`);
    
    let processedCount = 0;
    
    for (const obj of objects) {
      const key = obj.Key;
      // Skip directories/folders
      if (key.endsWith('/')) continue;
      
      console.log(`\nMemproses objek: ${key}`);
      
      // Parse key path
      // Format 1: imutflix/movies/<tmdbId>.<ext>
      // Format 2: imutflix/series/<tmdbId>/S<season>E<episode>.<ext>
      // Format 3: imutflix/imutflix/series/<tmdbId>/S<season>E<episode>.<ext> (sometimes nested)
      const movieMatch = key.match(/movies\/(\d+)\.[a-zA-Z0-9]+$/);
      const seriesMatch = key.match(/series\/(\d+)\/S(\d+)E(\d+)\.[a-zA-Z0-9]+$/);
      
      let originalTmdbId, mediaType, season = null, episode = null;
      
      if (movieMatch) {
        originalTmdbId = parseInt(movieMatch[1], 10);
        mediaType = 'movie';
      } else if (seriesMatch) {
        originalTmdbId = parseInt(seriesMatch[1], 10);
        season = parseInt(seriesMatch[2], 10);
        episode = parseInt(seriesMatch[3], 10);
        mediaType = 'series';
      } else {
        console.log(`--> Key tidak cocok dengan pola standar, dilewati.`);
        continue;
      }

      // Map overrides for incorrect IDs (e.g. IDLIX Post ID 39333617 -> TMDB ID 278573)
      const TMDB_MAP_OVERRIDES = {
        39333617: 278573 // Perfect Crown
      };
      
      const tmdbId = TMDB_MAP_OVERRIDES[originalTmdbId] || originalTmdbId;
      
      if (mediaType === 'movie') {
        console.log(`--> Terdeteksi Movie (TMDB ID: ${tmdbId}${tmdbId !== originalTmdbId ? ` overriding ${originalTmdbId}` : ''})`);
      } else {
        console.log(`--> Terdeteksi Series (TMDB ID: ${tmdbId}${tmdbId !== originalTmdbId ? ` overriding ${originalTmdbId}` : ''}, Season: ${season}, Episode: ${episode})`);
      }
      
      // Fetch details from TMDB
      try {
        let tmdbDetails;
        if (mediaType === 'movie') {
          tmdbDetails = await tmdb.getMovieDetail(tmdbId);
        } else {
          tmdbDetails = await tmdb.getTvDetail(tmdbId);
        }

        if (!tmdbDetails) {
          console.log(`--> [TMDB] Gagal menemukan data untuk ID ${tmdbId}, dilewati.`);
          continue;
        }
        
        const title = tmdbDetails.title || tmdbDetails.name || 'Unknown Title';
        const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        
        console.log(`--> Data TMDB diperoleh: "${title}"`);
        
        // Construct S3 URL
        const endpointClean = process.env.S3_ENDPOINT.replace(/\/$/, '');
        const s3Url = `${endpointClean}/${bucket}/${key}`;
        const filename = key.split('/').pop();
        
        // 1. Programmatic upsert into media_items
        let mediaItem = await db.query(
          `SELECT id FROM media_items WHERE tmdb_id = $1 AND media_type = $2`,
          [tmdbId, mediaType]
        );
        
        let mediaItemId;
        if (mediaItem.rows.length > 0) {
          mediaItemId = mediaItem.rows[0].id;
        } else {
          const insertRes = await db.query(
            `INSERT INTO media_items (tmdb_id, title, slug, media_type) VALUES ($1, $2, $3, $4) RETURNING id`,
            [tmdbId, title, slug, mediaType]
          );
          mediaItemId = insertRes.rows[0].id;
          console.log(`--> Berhasil mendaftarkan media_item baru (ID: ${mediaItemId})`);
        }
        
        // 2. Programmatic upsert into video_files
        let videoFile = await db.query(
          `SELECT id FROM video_files WHERE media_item_id = $1 AND (season = $2 OR (season IS NULL AND $2 IS NULL)) AND (episode = $3 OR (episode IS NULL AND $3 IS NULL))`,
          [mediaItemId, season, episode]
        );
        
        if (videoFile.rows.length > 0) {
          await db.query(
            `UPDATE video_files SET s3_key = $1, s3_url = $2, filename = $3 WHERE id = $4`,
            [key, s3Url, filename, videoFile.rows[0].id]
          );
          console.log(`--> Berhasil memperbarui berkas video ke database.`);
        } else {
          await db.query(
            `INSERT INTO video_files (media_item_id, season, episode, s3_key, s3_url, filename) VALUES ($1, $2, $3, $4, $5, $6)`,
            [mediaItemId, season, episode, key, s3Url, filename]
          );
          console.log(`--> Berhasil mendaftarkan berkas video baru ke database.`);
        }
        
        processedCount++;
        
      } catch (tmdbErr) {
        console.error(`❌ Gagal mendaftarkan ke database:`, tmdbErr.message);
      }
    }
    
    console.log("\n==================================================");
    console.log(`   PROSES SELESAI. Sukses meregistrasikan ${processedCount} file.`);
    console.log("==================================================");
    process.exit(0);
    
  } catch (err) {
    console.error("❌ Terjadi kesalahan utama:", err.message);
    process.exit(1);
  }
}

registerExisting();
