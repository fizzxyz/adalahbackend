'use strict';

const { Router } = require('express');
const internalController = require('../controllers/internal.controller');

const router = Router();

// Internal S3 upload registration
router.post('/register-media', internalController.registerMedia);

module.exports = router;
