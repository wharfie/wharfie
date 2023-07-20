'use strict';
const { URL } = require('url');
const http = require('http');
const https = require('https');

/**
 * @param {string} downloadURL -
 * @returns {Promise<Buffer>} -
 */
async function downloadUrlToBuffer(downloadURL) {
  const q = new URL(downloadURL.trim());
  const protocol = q.protocol === 'http' ? http : https;
  const options = {
    path: q.pathname,
    host: q.hostname,
    port: q.port,
  };
  return new Promise((resolve, reject) => {
    protocol.get(options, (res) => {
      const data = [];

      res.on('data', (chunk) => {
        data.push(chunk);
      });

      res.on('end', () => {
        // Combine the binary data into a single Buffer
        const buffer = Buffer.concat(data);
        resolve(buffer);
      });

      res.on('error', (err) => {
        reject(err);
      });
    });
  });
}

const handler = async (url) => {
  try {
    const buf = await downloadUrlToBuffer(url);
    return buf.byteLength;
  } catch (error) {
    console.trace(error);
    return 0;
  }
};

module.exports = { handler };
