'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const path = require('path');
const apiRoutes = require('./routes');
const mediaController = require('./controllers/media.controller');

function createApp() {
  const app = express();

  // Security & parsing middleware
  app.use(cors());
  app.use(helmet());
  app.use(express.json());

  // ── Root endpoints (directly mapped to match Retrofit BASE_API_URL endpoints) ──
  app.get('/search', mediaController.search);
  app.get('/play', mediaController.play);
  app.get('/play/lk21', mediaController.playLk21);

  // ── API routes ──────────────────────────────────────────────────────────
  app.use('/api', apiRoutes);

  // Static files (APK uploads, etc.)
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  // 404 catch-all
  app.use((req, res) => {
    res.status(404).json({ success: false, message: 'API endpoint not found' });
  });

  // Global error handler
  app.use((err, req, res, next) => {
    console.error('[Global Error Handler]:', err.stack || err.message);
    res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Internal server error'
    });
  });

  return app;
}

module.exports = createApp;
