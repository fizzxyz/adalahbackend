'use strict';

const dotenv = require('dotenv');
const path = require('path');

// Load environment variables from .env file
dotenv.config();

const providers = {};

// Fallback default S3 config as 'r2'
if (process.env.S3_ENDPOINT) {
  providers['r2'] = {
    ENDPOINT: process.env.S3_ENDPOINT,
    ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    BUCKET: process.env.S3_BUCKET
  };
}

const providerListStr = process.env.STORAGE_PROVIDERS || 'r2';
const providerList = providerListStr.split(',').map(p => p.trim());

for (const provider of providerList) {
  const upperProvider = provider.toUpperCase();
  const endpoint = process.env[`S3_${upperProvider}_ENDPOINT`];
  const accessKeyId = process.env[`S3_${upperProvider}_ACCESS_KEY_ID`];
  const secretAccessKey = process.env[`S3_${upperProvider}_SECRET_ACCESS_KEY`];
  const bucket = process.env[`S3_${upperProvider}_BUCKET`];

  if (endpoint && accessKeyId && secretAccessKey && bucket) {
    providers[provider.toLowerCase()] = {
      ENDPOINT: endpoint,
      ACCESS_KEY_ID: accessKeyId,
      SECRET_ACCESS_KEY: secretAccessKey,
      BUCKET: bucket
    };
  }
}

module.exports = {
  PORT: process.env.PORT || 3000,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  JWT_SECRET: process.env.JWT_SECRET || 'super_secret_jwt_key_imutflix',
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  
  TMDB: {
    API_KEY: process.env.TMDB_API_KEY || 'b91a01595a49acfb313f677a0f8ee669',
    BASE_URL: process.env.TMDB_BASE_URL || 'https://api.themoviedb.org/3'
  },
  
  S3: {
    ENDPOINT: process.env.S3_ENDPOINT,
    ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    BUCKET: process.env.S3_BUCKET,
    PROVIDERS: providers
  },
  
  INTERNAL_API_KEY: process.env.INTERNAL_API_KEY || 'imutflix_internal_secret_api_key_2026'
};
