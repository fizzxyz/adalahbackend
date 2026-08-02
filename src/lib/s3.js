'use strict';

const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { S3 } = require('../config/env');

const s3Client = new S3Client({
  endpoint: S3.ENDPOINT,
  region: 'auto', // Correct region for Cloudflare R2
  credentials: {
    accessKeyId: S3.ACCESS_KEY_ID,
    secretAccessKey: S3.SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // Necessary for custom domain endpoint paths
});

/**
 * Generate a pre-signed GET URL for a video file in S3.
 * @param {string} key - The S3 Key of the video file.
 * @param {number} expiresIn - Expiry time of the link in seconds (default: 86400 / 24 hours)
 * @returns {Promise<string>} The pre-signed streaming URL.
 */
async function getPresignedStreamUrl(key, expiresIn = 86400) {
  try {
    const command = new GetObjectCommand({
      Bucket: S3.BUCKET,
      Key: key,
    });
    
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (err) {
    console.error(`[S3 Error] Failed to generate presigned URL for key "${key}":`, err.message);
    return null;
  }
}

module.exports = {
  s3Client,
  getPresignedStreamUrl,
};
