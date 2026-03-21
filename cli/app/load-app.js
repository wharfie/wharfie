import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { compileManifest } from './compile-manifest.js';

/**
 * Load `wharfie.app.js` from disk and compile a JSON-safe manifest.
 * @param {{ dir?: string }} [options] - options.
 * @returns {Promise<{ appExport: any, manifest: any }>} - Result.
 */
export async function loadApp(options = {}) {
  const dir = options.dir ?? process.cwd();
  const appPath = path.resolve(dir, 'wharfie.app.js');

  try {
    await fsp.access(appPath);
  } catch {
    throw new Error(`Could not find wharfie.app.js in: ${dir}`);
  }

  const mod = await import(pathToFileURL(appPath).href);
  const appExport = mod?.default ?? mod?.app ?? mod?.actorSystem;
  if (!appExport) {
    throw new Error(
      'wharfie.app.js did not export an app. Expected a default export.',
    );
  }

  const manifest = compileManifest(appExport);
  return { appExport, manifest };
}

export default loadApp;
