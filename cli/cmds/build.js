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
const path = require('path');
const S3 = require('../../lambdas/lib/s3');
const STS = require('../../lambdas/lib/sts');
const child_process = require('child_process');

const s3 = new S3();
const sts = new STS();

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

const build = async (label) => {
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
    target: 'node20',
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
  const { Account } = await sts.getCallerIdentity();

  await Promise.all(
    LAMBDAS.map(async (lambda) => {
      await s3.putObject({
        Bucket:
          process.env.WHARFIE_ARTIFACT_BUCKET ||
          `${process.env.WHARFIE_DEPLOYMENT_NAME}-${Account}-${process.env.WHARFIE_REGION}`,
        Key: `wharfie/${label}/${lambda}.zip`,
        Body: await fs.promises.readFile(
          path.join(__dirname, `../../dist/${label}/${lambda}/ouput.zip`)
        ),
      });
    })
  );

  displaySuccess('Build succeeded');
};

exports.command = 'build [label]';
exports.desc = 'build wharfie lambda artifacts';
exports.builder = (yargs) => {
  yargs.positional('label', {
    type: 'string',
    describe: 'build artifact prefix',
    optional: true,
  });
};
exports.handler = async function ({ label }) {
  try {
    await build(label);
  } catch (err) {
    displayFailure(err);
  }
};
