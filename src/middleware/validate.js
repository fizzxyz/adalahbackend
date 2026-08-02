'use strict';

function validatePage(req, res, next) {
  const { page } = req.params;
  if (page !== undefined) {
    const parsed = parseInt(page, 10);
    if (isNaN(parsed) || parsed < 1 || String(parsed) !== String(page)) {
      return res
        .status(400)
        .json({ success: false, message: 'Invalid page number. Must be a positive integer.' });
    }
    req.params.page = parsed;
  }
  next();
}

function validateGenre(req, res, next) {
  const { genre } = req.params;
  if (!genre || !/^[a-z0-9-]+$/i.test(genre)) {
    return res
      .status(400)
      .json({ success: false, message: 'Invalid genre. Only letters, numbers and hyphens are allowed.' });
  }
  next();
}

function validateSlug(req, res, next) {
  const values = req.params || {};
  const slug = values.slug || values.value || values.country || values.network || values.genre;
  if (!slug || !/^[a-z0-9-]+$/i.test(slug)) {
    return res
      .status(400)
      .json({ success: false, message: 'Invalid value. Only letters, numbers and hyphens are allowed.' });
  }
  next();
}

function validateMediaSlug(req, res, next) {
  const { slug } = req.params;
  if (!slug || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i.test(slug)) {
    return res
      .status(400)
      .json({ success: false, message: 'Invalid slug. Only letters, numbers and hyphens are allowed.' });
  }
  next();
}

function validateYear(req, res, next) {
  const year = req.params.year || req.params.value;
  if (!year || !/^(19|20)\d{2}$/.test(String(year))) {
    return res
      .status(400)
      .json({ success: false, message: 'Invalid year. Must be a four-digit year.' });
  }
  next();
}

function validateSearchQuery(req, res, next) {
  const q = String(req.query.q || '').trim();
  if (!q || q.length < 2) {
    return res
      .status(400)
      .json({ success: false, message: 'Query parameter "q" is required and must be at least 2 characters.' });
  }
  req.query.q = q;
  next();
}

function validateEpisodeParams(req, res, next) {
  const { season, episode } = req.params;
  const s = parseInt(season, 10);
  const e = parseInt(episode, 10);

  if (isNaN(s) || s < 1 || String(s) !== String(season)) {
    return res.status(400).json({ success: false, message: 'Invalid season number. Must be a positive integer.' });
  }
  if (isNaN(e) || e < 1 || String(e) !== String(episode)) {
    return res.status(400).json({ success: false, message: 'Invalid episode number. Must be a positive integer.' });
  }

  req.params.season  = s;
  req.params.episode = e;
  next();
}

module.exports = { 
  validatePage, 
  validateGenre, 
  validateSlug, 
  validateMediaSlug, 
  validateYear, 
  validateSearchQuery, 
  validateEpisodeParams 
};
