// keys.js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const crypto = require('hypercore-crypto'); // comes with hypercore

/**
 *
 * @param filePath
 */
function loadOrCreateKeypair(filePath) {
  const p = path.resolve(filePath);
  if (fs.existsSync(p)) {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      publicKey: Buffer.from(j.publicKey, 'hex'),
      secretKey: Buffer.from(j.secretKey, 'hex'),
    };
  }
  const kp = crypto.keyPair();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(
    p,
    JSON.stringify(
      {
        publicKey: kp.publicKey.toString('hex'),
        secretKey: kp.secretKey.toString('hex'),
      },
      null,
      2
    ),
    'utf8'
  );
  return kp;
}

module.exports = { loadOrCreateKeypair };
