'use strict';

const { Router } = require('express');
const mediaController = require('../controllers/media.controller');
const { validatePage, validateMediaSlug, validateEpisodeParams, validateSlug, validateYear } = require('../middleware/validate');

const router = Router();

// Search
router.get('/search', mediaController.search);

// Play
router.get('/play', mediaController.play);
router.get('/play/lk21', mediaController.playLk21);

// Episode Available
router.get('/episodes/available', mediaController.getAvailableEpisodes);

// ── TMDB Mock Proxy routes for Android Client ──
router.get('/trending/all/day', mediaController.mockTrending);
router.get('/movie/now_playing', mediaController.mockMovies);
router.get('/movie/popular', mediaController.mockMovies);
router.get('/discover/movie', mediaController.mockMovies);
router.get('/tv/popular', mediaController.mockTv);
router.get('/discover/tv', mediaController.mockTv);
router.get('/search/multi', mediaController.mockSearch);
router.get('/movie/:id(\\d+)', mediaController.proxyMovieDetail);
router.get('/tv/:id(\\d+)', mediaController.proxyTvDetail);

// Homepage sections
router.get('/featured', mediaController.featured);
router.get('/cinemaxxi', mediaController.cinemaxxi);
router.get('/home', mediaController.home);
router.get('/home/sections', mediaController.homeSections);

// Movie Routes
router.get('/movie', mediaController.browseMovies);
router.get('/movie/trending', mediaController.browseMovies);
router.get('/movie/trending/:page', validatePage, mediaController.browseMovies);
router.get('/movie/:slug', validateMediaSlug, mediaController.movieDetail);
router.get('/movie/:slug/stream', validateMediaSlug, mediaController.movieStream);

// Series Routes
router.get('/series', mediaController.browseSeries);
router.get('/series/trending', mediaController.browseSeries);
router.get('/series/:slug', validateMediaSlug, mediaController.seriesDetail);
router.get('/series/:slug/stream', validateMediaSlug, mediaController.seriesStream);
router.get('/series/:slug/season/:season/episode/:episode/stream', validateMediaSlug, validateEpisodeParams, mediaController.episodeStream);

// Category Routes (compatibility placeholders)
const categoryRouter = Router();
categoryRouter.get('/:value', (req, res) => {
  res.json({ success: true, data: [] });
});

module.exports = {
  mediaRouter: router,
  categoryRouter
};
