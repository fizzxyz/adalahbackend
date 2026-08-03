'use strict';

const { Router } = require('express');
const userRoutes = require('./user.routes');
const { mediaRouter, categoryRouter } = require('./media.routes');
const internalRoutes = require('./internal.routes');
const mediaController = require('../controllers/media.controller');

const router = Router();

// 1. User & Auth routes (/api/auth, /api/progress, /api/watchlist)
router.use('/', userRoutes);

// 2. App Update Check endpoint for Android client
const LATEST_APP_UPDATE = {
  versionCode: 4,
  versionName: "1.0.4",
  apkPath: "/uploads/imutflix.apk",
  changelog: "More faster n reliable stream with cdn",
  forceUpdate: true
};

router.get('/update-check', (req, res) => {
  const host = req.headers.host || `localhost:${process.env.PORT || 3000}`;
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  res.json({
    versionCode: LATEST_APP_UPDATE.versionCode,
    versionName: LATEST_APP_UPDATE.versionName,
    apkUrl: `${protocol}://${host}${LATEST_APP_UPDATE.apkPath}`,
    changelog: LATEST_APP_UPDATE.changelog,
    forceUpdate: LATEST_APP_UPDATE.forceUpdate
  });
});

// 3. Available episodes route for Android client
router.get('/episodes/available', mediaController.getAvailableEpisodes);

// 4. Media routes (/api/featured, /api/cinemaxxi, /api/movie, /api/series, /api/search)
router.use('/', mediaRouter);

// 5. Category routes (for compatibility)
router.use('/genre', categoryRouter);
router.use('/country', categoryRouter);
router.use('/year', categoryRouter);
router.use('/network', categoryRouter);

// 6. Internal Admin routes (/api/internal/register-media)
router.use('/internal', internalRoutes);

module.exports = router;
