'use strict';

const { Router } = require('express');
const userController = require('../controllers/user.controller');
const authenticateToken = require('../middleware/authenticate');

const router = Router();

// Authentication
router.post('/auth/google', userController.loginGoogle);
router.post('/auth/mock', userController.loginMock);

// Watch Progress
router.post('/progress', authenticateToken, userController.saveProgress);
router.get('/progress', authenticateToken, userController.getAllWatchProgress);
router.get('/progress/:mediaId', authenticateToken, userController.getWatchProgress);

// Watchlist
router.post('/watchlist', authenticateToken, userController.addToWatchlist);
router.delete('/watchlist/:mediaId', authenticateToken, userController.removeFromWatchlist);
router.get('/watchlist', authenticateToken, userController.getWatchlist);
router.get('/watchlist/:mediaId/status', authenticateToken, userController.getWatchlistStatus);

module.exports = router;
