'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { S3 } = require('../config/env');

const s3Clients = {};

/**
 * Get S3 Client for a specific provider
 * @param {string} provider
 * @returns {S3Client}
 */
function getS3ClientForProvider(provider = 'r2') {
  const normProvider = provider.toLowerCase();
  if (s3Clients[normProvider]) {
    return s3Clients[normProvider];
  }

  const config = S3.PROVIDERS[normProvider];
  if (!config) {
    throw new Error(`S3 Storage provider "${provider}" is not configured in environment variables.`);
  }

  const client = new S3Client({
    endpoint: config.ENDPOINT,
    region: 'auto',
    credentials: {
      accessKeyId: config.ACCESS_KEY_ID,
      secretAccessKey: config.SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  s3Clients[normProvider] = client;
  return client;
}

/**
 * Generate a pre-signed GET URL for a video file in S3.
 * @param {string} key - The S3 Key of the video file.
 * @param {string} provider - The storage provider name (e.g. 'r2', 'dahono')
 * @param {number} expiresIn - Expiry time of the link in seconds (default: 86400 / 24 hours)
 * @returns {Promise<string>} The pre-signed streaming URL.
 */
async function getPresignedStreamUrl(key, provider = 'r2', expiresIn = 86400) {
  try {
    const normProvider = (provider || 'r2').toLowerCase();
    const client = getS3ClientForProvider(normProvider);
    const config = S3.PROVIDERS[normProvider];

    const command = new GetObjectCommand({
      Bucket: config.BUCKET,
      Key: key,
    });
    
    const signedUrl = await getSignedUrl(client, command, { expiresIn });
    return signedUrl;
  } catch (err) {
    console.error(`[S3 Error] Failed to generate presigned URL for key "${key}" using provider "${provider}":`, err.message);
    return null;
  }
}

module.exports = {
  s3Clients,
  getS3ClientForProvider,
  getPresignedStreamUrl,
};
