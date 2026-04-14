import { fileURLToPath } from 'node:url';

/**
 * @param {string | undefined} value - value.
 * @returns {string | undefined} - Result.
 */
function normalizeOptionalString(value) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * @param {{ cliEntrypointPath?: string, cliExportName?: string }} [options] - options.
 * @returns {string} - Result.
 */
export function createPackagedAppEntryCode(options = {}) {
  const cliEntrypointPath = normalizeOptionalString(options.cliEntrypointPath);
  const cliExportName = normalizeOptionalString(options.cliExportName);
  const packagedAppEntryPath = fileURLToPath(
    new URL('../packaged-app-entry.js', import.meta.url),
  );

  return `
    import { runPackagedApp } from ${JSON.stringify(packagedAppEntryPath)};
    import sourceMapSupport from 'source-map-support';
    ${
      cliEntrypointPath
        ? `import * as appCliModule from ${JSON.stringify(cliEntrypointPath)};`
        : 'const appCliModule = undefined;'
    }
    (async () => {
      console.time('overall');
      sourceMapSupport.install();
      await runPackagedApp({
        cliModule: appCliModule,
        ${
          cliExportName
            ? `cliExportName: ${JSON.stringify(cliExportName)},`
            : ''
        }
        argv: process.argv,
      });
      console.timeEnd('overall');
    })();
  `;
}

export default createPackagedAppEntryCode;
