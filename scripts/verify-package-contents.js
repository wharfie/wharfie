import { createPackageTarball } from './package-verification.js';

const packaged = createPackageTarball();

try {
  process.stdout.write(
    `Verified ${packaged.manifest.files.length} files in ${packaged.manifest.filename}\n`,
  );
} finally {
  packaged.cleanup();
}
