const { Pool } = require('pg');
const { getGDriveClient } = require('../src/lib/gdrive');
const { getS3ClientForProvider } = require('../src/lib/s3');
const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { S3 } = require('../src/config/env');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const args = process.argv.slice(2);
  const tmdbIdIndex = args.indexOf('--tmdb');
  
  if (tmdbIdIndex === -1 || !args[tmdbIdIndex + 1]) {
    console.error("Error: Please provide TMDB ID using: node scripts/delete-media.js --tmdb <TMDB_ID>");
    process.exit(1);
  }
  
  const tmdbId = parseInt(args[tmdbIdIndex + 1], 10);
  if (isNaN(tmdbId)) {
    console.error("Error: TMDB ID must be a number.");
    process.exit(1);
  }

  try {
    // 1. Find the media item in the database
    const mediaRes = await pool.query('SELECT * FROM media_items WHERE tmdb_id = $1', [tmdbId]);
    if (mediaRes.rows.length === 0) {
      console.log(`[DB] Media item with TMDB ID ${tmdbId} not found in database.`);
      return;
    }

    const mediaItem = mediaRes.rows[0];
    console.log(`Found Media Item: "${mediaItem.title}" (${mediaItem.media_type.toUpperCase()})`);

    // 2. Find all associated video files
    const fileRes = await pool.query('SELECT * FROM video_files WHERE media_item_id = $1', [mediaItem.id]);
    console.log(`Found ${fileRes.rows.length} video file(s) in database.`);

    let gdriveClient = null;
    const deletedFolders = new Set();

    for (const file of fileRes.rows) {
      const provider = file.storage_provider || 'r2';
      const key = file.s3_key;
      
      console.log(`Processing file: ${file.filename} (Provider: ${provider}, Key/ID: ${key})`);

      if (provider === 'gdrive') {
        // ── Delete from Google Drive ──
        if (!gdriveClient) {
          gdriveClient = await getGDriveClient();
        }
        if (!gdriveClient) {
          console.error(`[GDrive Error] Could not load Google Drive client. Skipping file ID: ${key}`);
          continue;
        }

        try {
          // Get metadata to find parent folder before deleting the file
          const fileMeta = await gdriveClient.request({
            url: `https://www.googleapis.com/drive/v3/files/${key}?fields=parents`,
            method: 'GET'
          }).catch(() => null);

          // Delete the file
          console.log(`[GDrive] Deleting file ${file.filename} (ID: ${key})...`);
          await gdriveClient.request({
            url: `https://www.googleapis.com/drive/v3/files/${key}`,
            method: 'DELETE'
          });
          console.log(`[GDrive] File deleted successfully.`);

          // Collect parent folders to delete later
          if (fileMeta && fileMeta.data && fileMeta.data.parents) {
            for (const parentId of fileMeta.data.parents) {
              deletedFolders.add(parentId);
            }
          }
        } catch (err) {
          console.error(`[GDrive Error] Failed to delete file ${key}:`, err.message);
        }
      } else {
        // ── Delete from S3 (R2/Dahono) ──
        try {
          const s3Client = getS3ClientForProvider(provider);
          const config = S3.PROVIDERS[provider.toLowerCase()];
          
          console.log(`[S3] Deleting object key "${key}" from bucket "${config.BUCKET}"...`);
          await s3Client.send(new DeleteObjectCommand({
            Bucket: config.BUCKET,
            Key: key
          }));
          console.log(`[S3] Object deleted successfully.`);
        } catch (err) {
          console.error(`[S3 Error] Failed to delete S3 object "${key}":`, err.message);
        }
      }
    }

    // ── Delete parent folders on Google Drive if they are now empty ──
    if (gdriveClient && deletedFolders.size > 0) {
      for (const folderId of deletedFolders) {
        try {
          // Check if folder still contains files
          const listRes = await gdriveClient.request({
            url: `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false&fields=files(id)`,
            method: 'GET'
          });

          if (listRes.data.files && listRes.data.files.length === 0) {
            console.log(`[GDrive] Folder "${folderId}" is empty. Deleting folder...`);
            await gdriveClient.request({
              url: `https://www.googleapis.com/drive/v3/files/${folderId}`,
              method: 'DELETE'
            });
            console.log(`[GDrive] Folder deleted successfully.`);
          } else {
            console.log(`[GDrive] Folder "${folderId}" is not empty. Kept.`);
          }
        } catch (err) {
          // Folder might already be deleted or not found
        }
      }
    }

    // 3. Delete from Database
    console.log(`[DB] Deleting records from database...`);
    // Delete video files first
    const delFilesRes = await pool.query('DELETE FROM video_files WHERE media_item_id = $1', [mediaItem.id]);
    console.log(`[DB] Deleted ${delFilesRes.rowCount} video file records.`);

    // Delete media item
    const delMediaRes = await pool.query('DELETE FROM media_items WHERE id = $1', [mediaItem.id]);
    console.log(`[DB] Deleted media item "${mediaItem.title}" from database.`);
    
    console.log(`\n✅ Media item "${mediaItem.title}" and its storage files have been deleted successfully!`);

  } catch (err) {
    console.error("Error running delete-media script:", err.message);
  } finally {
    await pool.end();
  }
}

main();
