require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const migrateQuery = `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255),
    picture TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS watch_progress (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id VARCHAR(255) NOT NULL,
    media_type VARCHAR(50) NOT NULL,
    season INTEGER DEFAULT 1,
    episode INTEGER DEFAULT 1,
    position_ms BIGINT NOT NULL,
    duration_ms BIGINT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    title VARCHAR(255),
    poster_path TEXT,
    backdrop_path TEXT,
    rating VARCHAR(50),
    release_year VARCHAR(50),
    original_title VARCHAR(255),
    overview TEXT,
    UNIQUE (user_id, media_id, media_type, season, episode)
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_id VARCHAR(255) NOT NULL,
    media_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    poster_path TEXT,
    backdrop_path TEXT,
    rating VARCHAR(50),
    release_year VARCHAR(50),
    original_title VARCHAR(255),
    overview TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, media_id, media_type)
  );

  CREATE TABLE IF NOT EXISTS manual_slugs (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    original_title VARCHAR(255),
    media_type VARCHAR(50) NOT NULL,
    provider VARCHAR(50) NOT NULL,
    slug VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (title, media_type, provider)
  );

  CREATE TABLE IF NOT EXISTS media_items (
    id SERIAL PRIMARY KEY,
    tmdb_id INTEGER NOT NULL,
    media_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tmdb_id, media_type)
  );

  CREATE TABLE IF NOT EXISTS video_files (
    id SERIAL PRIMARY KEY,
    media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    season INTEGER DEFAULT NULL,
    episode INTEGER DEFAULT NULL,
    s3_key VARCHAR(512) NOT NULL,
    s3_url TEXT NOT NULL,
    filename VARCHAR(255) NOT NULL,
    storage_provider VARCHAR(50) DEFAULT 'r2',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(media_item_id, season, episode)
  );

  ALTER TABLE video_files ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(50) DEFAULT 'r2';
`;

async function runMigration() {
  console.log('Running database migrations for Imutflix Backend...');
  try {
    await pool.query(migrateQuery);
    console.log('Migrations run successfully! All tables are ready.');
  } catch (err) {
    console.error('Error running migrations:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
