'use strict';

const { createClient } = require('redis');
const { REDIS_URL } = require('../config/env');

let client = null;
let isConnected = false;

// Resilient in-memory fallback cache
const localCache = new Map();

async function connectRedis() {
  try {
    client = createClient({ url: REDIS_URL });
    
    client.on('error', (err) => {
      console.error('Redis client error:', err.message);
      isConnected = false;
    });

    client.on('connect', () => {
      console.log('Redis client connected');
      isConnected = true;
    });

    await client.connect();
  } catch (err) {
    console.error('Redis connection failed, using in-memory cache:', err.message);
    isConnected = false;
    client = null;
  }
}

// Initialize connection asynchronously
connectRedis();

module.exports = {
  get: async (key) => {
    if (isConnected && client) {
      try {
        return await client.get(key);
      } catch (err) {
        console.error('Redis get failed, fallback to localCache:', err.message);
      }
    }
    return localCache.get(key) || null;
  },
  
  setEx: async (key, seconds, value) => {
    if (isConnected && client) {
      try {
        await client.setEx(key, seconds, value);
        return;
      } catch (err) {
        console.error('Redis setEx failed, fallback to localCache:', err.message);
      }
    }
    localCache.set(key, value);
    // Simulate auto-expiry for localCache
    setTimeout(() => localCache.delete(key), seconds * 1000);
  },

  del: async (key) => {
    if (isConnected && client) {
      try {
        await client.del(key);
        return;
      } catch (err) {
        console.error('Redis del failed, fallback to localCache:', err.message);
      }
    }
    localCache.delete(key);
  }
};
