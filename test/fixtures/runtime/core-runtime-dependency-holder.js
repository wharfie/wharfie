import { promises as fsp } from 'node:fs';

import {
  CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME,
  CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME,
} from '../../../src/core/resources/builds/lib/core-runtime-dependency-asset.js';
import { preparePackagedCoreRuntimeDependencies } from '../../../src/core/runtime/core-runtime-dependencies.js';

const configuration =
  /** @type {{manifestPath: string, archivePath: string, tempParent: string}} */ (
    JSON.parse(process.argv[2] || '{}')
  );
const [manifestBytes, archiveBytes] = await Promise.all([
  fsp.readFile(configuration.manifestPath),
  fsp.readFile(configuration.archivePath),
]);
const manifest = JSON.parse(manifestBytes.toString('utf8'));
const assets = /** @type {Record<string, Buffer>} */ ({
  [CORE_RUNTIME_DEPENDENCY_MANIFEST_ASSET_NAME]: manifestBytes,
  [CORE_RUNTIME_DEPENDENCY_ARCHIVE_ASSET_NAME]: archiveBytes,
});
const prepared = await preparePackagedCoreRuntimeDependencies({
  assetProvider: {
    isSea: () => true,
    getAsset: (name) => assets[name],
  },
  readEmbeddedRevisionRuntimePair: async () => ({
    runtime: { target: manifest.target },
  }),
  tempParent: configuration.tempParent,
});

if (!prepared || typeof process.send !== 'function') {
  throw new Error('Core runtime dependency holder requires an IPC parent.');
}
process.send({ root: prepared.root, type: 'ready' });
setInterval(() => {}, 60_000);
