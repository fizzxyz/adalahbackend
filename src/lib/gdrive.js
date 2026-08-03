'use strict';

const { OAuth2Client } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

// Dynamically resolve credentials and tokens from the gdrive directory
const credentialsPath = path.join(__dirname, '..', '..', 'gdrive', 'credentials.json');
const tokenPath = path.join(__dirname, '..', '..', 'gdrive', 'token.json');

/**
 * Get an authenticated Google OAuth2 Client
 * @returns {Promise<OAuth2Client|null>}
 */
async function getGDriveClient() {
  try {
    if (!fs.existsSync(credentialsPath) || !fs.existsSync(tokenPath)) {
      console.warn('[GDrive Warning] Missing credentials.json or token.json in gdrive/ directory.');
      return null;
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));

    // Extract client info (supporting both installed/desktop and web app OAuth clients)
    const clientInfo = credentials.installed || credentials.web;
    if (!clientInfo) {
      console.error('[GDrive Error] Invalid credentials.json format.');
      return null;
    }

    const oAuth2Client = new OAuth2Client(
      clientInfo.client_id,
      clientInfo.client_secret,
      clientInfo.redirect_uris ? clientInfo.redirect_uris[0] : 'http://localhost'
    );

    oAuth2Client.setCredentials(token);

    // Automatically handle token refresh if it has expired
    oAuth2Client.on('tokens', (newTokens) => {
      try {
        const mergedToken = { ...token, ...newTokens };
        fs.writeFileSync(tokenPath, JSON.stringify(mergedToken, null, 2), 'utf8');
        console.log('[GDrive] Access token refreshed and saved successfully.');
      } catch (err) {
        console.error('[GDrive Error] Failed to save refreshed token:', err.message);
      }
    });

    return oAuth2Client;
  } catch (err) {
    console.error('[GDrive Error] Error loading Google Drive OAuth client:', err.message);
    return null;
  }
}

module.exports = {
  getGDriveClient
};
