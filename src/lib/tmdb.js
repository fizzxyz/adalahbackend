'use strict';

const { TMDB } = require('../config/env');
const redis = require('./redis');

/**
 * Fetch data from TMDB API with cache layer.
 * @param {string} path - TMDB endpoint path (e.g. '/movie/123')
 * @param {Object} params - Query parameters
 * @param {number} cacheTtl - Cache duration in seconds (default: 86400 / 24 hours)
 * @returns {Promise<Object>} The API response
 */
async function fetchTmdb(path, params = {}, cacheTtl = 86400) {
  const queryParams = new URLSearchParams({
    api_key: TMDB.API_KEY,
    language: 'en-US', // Fetch in English to prevent original language characters (like Hangul/Korean) by default
    ...params
  });
  
  const url = `${TMDB.BASE_URL}${path}?${queryParams.toString()}`;
  const cacheKey = `tmdb:${path}:${JSON.stringify(params)}`;
  
  try {
    // 1. Try cache
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    
    // 2. Fetch from TMDB
    console.log(`[TMDB] Fetching API: ${path}`);
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) return null;
      throw new Error(`TMDB responded with status ${res.status}`);
    }
    
    const data = await res.json();
    
    // 3. Cache response if valid
    if (data) {
      await redis.setEx(cacheKey, cacheTtl, JSON.stringify(data));
    }
    
    return data;
  } catch (err) {
    console.error(`[TMDB Error] Failed to fetch path "${path}":`, err.message);
    
    // Fallback: If Redis was down but we hit an error, try fetching directly without caching
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch (_) {}
    
    return null;
  }
}

/**
 * Map TMDB Movie details into Imutflix standardized schema.
 */
function mapMovieDetail(item, slug) {
  if (!item) return null;
  
  const releaseYear = item.release_date ? parseInt(item.release_date.substring(0, 4), 10) : null;
  const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null;
  const backdropUrl = item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null;
  
  // Find Director
  const credits = item.credits || {};
  const crew = credits.crew || [];
  const director = crew.find(member => member.job === 'Director');
  
  // Cast mapping
  const cast = (credits.cast || []).slice(0, 15).map(c => ({
    name: c.name,
    character: c.character,
    image: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
  }));
  
  // Trailer mapping
  const videos = item.videos?.results || [];
  const trailerVideo = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') || videos.find(v => v.site === 'YouTube');
  const trailerUrl = trailerVideo ? `https://www.youtube.com/watch?v=${trailerVideo.key}` : null;
  
  return {
    title: item.title || item.original_title || '',
    year: releaseYear,
    type: 'movie',
    runtime: item.runtime ? `PT${item.runtime}M` : null,
    runtimeMinutes: item.runtime || null,
    overview: item.overview || null,
    poster: posterUrl,
    backdrop: backdropUrl,
    genres: (item.genres || []).map(g => g.name),
    country: item.production_countries?.[0]?.name || null,
    countryCode: item.production_countries?.[0]?.iso_3166_1 || null,
    language: item.original_language || null,
    director: director ? { name: director.name, url: null } : null,
    cast,
    trailer: trailerUrl,
    watchUrl: `/movie/${slug}?play=1`,
    streamUrl: null,
    keywords: (item.keywords?.keywords || []).map(k => k.name),
    recommendations: (item.recommendations?.results || []).slice(0, 10).map(r => ({
      title: r.title,
      slug: `${r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${r.id}`,
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : null,
      rating: r.vote_average
    })),
    seasons: null
  };
}

/**
 * Map TMDB TV Series details into Imutflix standardized schema.
 */
function mapTvDetail(item, slug) {
  if (!item) return null;
  
  const releaseYear = item.first_air_date ? parseInt(item.first_air_date.substring(0, 4), 10) : null;
  const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w300${item.poster_path}` : null;
  const backdropUrl = item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null;
  
  // Find Director / Creator
  const creator = item.created_by?.[0]?.name;
  
  const credits = item.credits || {};
  const cast = (credits.cast || []).slice(0, 15).map(c => ({
    name: c.name,
    character: c.character,
    image: c.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : null
  }));
  
  const videos = item.videos?.results || [];
  const trailerVideo = videos.find(v => v.site === 'YouTube' && v.type === 'Trailer') || videos.find(v => v.site === 'YouTube');
  const trailerUrl = trailerVideo ? `https://www.youtube.com/watch?v=${trailerVideo.key}` : null;
  
  return {
    title: item.name || item.original_name || '',
    year: releaseYear,
    type: 'series',
    runtime: item.episode_run_time?.[0] ? `PT${item.episode_run_time[0]}M` : null,
    runtimeMinutes: item.episode_run_time?.[0] || null,
    overview: item.overview || null,
    poster: posterUrl,
    backdrop: backdropUrl,
    genres: (item.genres || []).map(g => g.name),
    country: item.production_countries?.[0]?.name || null,
    countryCode: item.production_countries?.[0]?.iso_3166_1 || null,
    language: item.original_language || null,
    director: creator ? { name: creator, url: null } : null,
    cast,
    trailer: trailerUrl,
    watchUrl: `/series/${slug}?play=1`,
    streamUrl: null,
    keywords: (item.keywords?.results || []).map(k => k.name),
    recommendations: (item.recommendations?.results || []).slice(0, 10).map(r => ({
      title: r.name,
      slug: `${r.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${r.id}`,
      poster: r.poster_path ? `https://image.tmdb.org/t/p/w300${r.poster_path}` : null,
      rating: r.vote_average
    })),
    seasons: (item.seasons || []).filter(s => s.season_number > 0).map(s => ({
      name: s.name,
      seasonNumber: s.season_number,
      episodeCount: s.episode_count,
      episodes: [] // Populated separately when requested
    }))
  };
}

module.exports = {
  fetchTmdb,
  getMovieDetail: async (tmdbId) => fetchTmdb(`/movie/${tmdbId}`, { append_to_response: 'credits,videos,recommendations,keywords' }),
  getTvDetail: async (tmdbId) => fetchTmdb(`/tv/${tmdbId}`, { append_to_response: 'credits,videos,recommendations,keywords' }),
  getTvSeasonDetail: async (tmdbId, seasonNumber) => fetchTmdb(`/tv/${tmdbId}/season/${seasonNumber}`),
  mapMovieDetail,
  mapTvDetail
};
