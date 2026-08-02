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
  versionCode: 3,
  versionName: "1.0.3",
  apkPath: "/uploads/imutflix.apk",
  changelog: "Fix pemutar media",
  forceUpdate: true
};

router.get('/update-check', (req, res) => {
  const host = req.headers.host || `localhost:${process.env.PORT || 3000}`;
  res.json({
    versionCode: LATEST_APP_UPDATE.versionCode,
    versionName: LATEST_APP_UPDATE.versionName,
    apkUrl: `http://${host}${LATEST_APP_UPDATE.apkPath}`,
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
