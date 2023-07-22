'use strict';
const esbuild = require('esbuild');
const JSZip = require('jszip');
const fs = require('fs');

const {
  displayFailure,
  displayWarning,
  displayInfo,
  displaySuccess,
} = require('../output');
const config = require('../config');
const { region, artifact_bucket } = config.getConfig();
process.env.AWS_REGION = region;
const path = require('path');
const S3 = require('../../lambdas/lib/s3');
const s3 = new S3({
  region,
});
const child_process = require('child_process');

const LAMBDAS = ['bootstrap', 'cleanup', 'daemon', 'events', 'monitor'];

const zip = async (dir) => {
  const zipInstance = new JSZip();
  zipInstance.file('index.js', await fs.promises.readFile(`${dir}/index.js`));
  await new Promise((resolve, reject) => {
    zipInstance
      .generateNodeStream({ type: 'nodebuffer', streamFiles: true })
      .pipe(fs.createWriteStream(`${dir}/ouput.zip`))
      .on('finish', resolve)
      .on('error', reject);
  });
};

const build = async (label, publish) => {
  // esbuild lambdas
  displayInfo('Building lambdas...');
  if (!label) {
    const label = child_process
      .execSync('git rev-parse HEAD')
      .toString()
      .trim();
    if (!label) {
      throw new Error(
        'no label provide and unable to determine git SHA, please provide a label argument'
      );
    }
  }
  const result = await esbuild.build({
    entryPoints: LAMBDAS.map((lambda) =>
      path.join(__dirname, `../../lambdas/${lambda}.js`)
    ),
    entryNames: '[dir]/[name]/index',
    bundle: true,
    minify: true,
    sourcemap: 'inline',
    platform: 'node',
    target: 'node18',
    outdir: `dist/${label}`,
  });

  if (result.errors.length) {
    throw new Error(result.errors);
  }
  if (result.warnings.length) {
    displayWarning(result.warnings);
  }

  displayInfo('Zipping bundles...');
  // zip lambdas
  await Promise.all(
    LAMBDAS.map(async (lambda) => {
      await zip(path.join(__dirname, `../../dist/${label}/${lambda}`));
    })
  );

  displayInfo('Uploading bundles to S3...');
  await Promise.all(
    LAMBDAS.map(async (lambda) => {
      await s3.putObject({
        Bucket: artifact_bucket,
        Key: `wharfie/${label}/${lambda}.zip`,
        Body: await fs.promises.readFile(
          path.join(__dirname, `../../dist/${label}/${lambda}/ouput.zip`)
        ),
        ACL: publish ? 'public-read' : 'private',
      });
    })
  );

  displaySuccess('Build succeeded');
};

exports.command = 'build [label]';
exports.desc = 'build wharfie lambda artifacts';
exports.builder = (yargs) => {
  yargs
    .positional('label', {
      type: 'string',
      describe: 'build artifact prefix',
      optional: true,
    })
    .option('publish', {
      type: 'boolean',
      describe: 'make build artifacts public',
      default: false,
    });
};
exports.handler = async function ({ label, publish }) {
  try {
    await build(label, publish);
  } catch (err) {
    displayFailure(err);
  }
};
