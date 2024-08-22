'use strict';
const esbuild = require('esbuild');
const JSZip = require('jszip');
const fs = require('fs');

const {
  displayFailure,
  displayWarning,
  displayInfo,
  displaySuccess,
} = require('../../output/basic');
const path = require('path');
const S3 = require('../../../lambdas/lib/s3');
const STS = require('../../../lambdas/lib/sts');
const child_process = require('child_process');

const s3 = new S3();
const sts = new STS();

/**
 * @param {string} dir -
 */
const zip = async (dir) => {
  const zipInstance = new JSZip();
  // Read directory
  const files = await fs.promises.readdir(dir);

  // Loop over files
  for (const file of files) {
    const filePath = path.join(dir, file);

    // Only add file if it's not a directory
    const stats = await fs.promises.stat(filePath);
    if (stats.isFile()) {
      const fileData = await fs.promises.readFile(filePath);
      zipInstance.file(file, fileData);
    }
  }
  await new Promise((resolve, reject) => {
    zipInstance
      .generateNodeStream({ type: 'nodebuffer', streamFiles: true })
      .pipe(fs.createWriteStream(`${dir}/ouput.zip`))
      .on('finish', resolve)
      .on('error', reject);
  });
};

/**
 * @param {string} udf_name -
 * @param {string} entrypoint -
 * @param {string} label -
 */
const build = async (udf_name, entrypoint, label) => {
  // esbuild lambdas
  displayInfo('Building udf...');
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
  const entrypointFilePath = path.join(process.cwd(), entrypoint);
  await fs.promises.access(entrypointFilePath);

  const result = await esbuild.build({
    entryPoints: [
      path.join(__dirname, `../../../lambdas/udf_entrypoint.js`),
      entrypointFilePath,
    ],
    entryNames: '[name]',
    bundle: true,
    minify: true,
    sourcemap: 'inline',
    platform: 'node',
    target: 'node20',
    outdir: `dist/udf/${udf_name}/${label}`,
  });

  if (result.errors.length) {
    throw new Error(JSON.stringify(result.errors));
  }
  if (result.warnings.length) {
    displayWarning(result.warnings);
  }

  displayInfo('Zipping udf bundle...');
  // zip lambdas
  await zip(path.join(__dirname, `../../../dist/udf/${udf_name}/${label}`));

  displayInfo('Uploading udf bundle to S3...');
  const { Account } = await sts.getCallerIdentity();

  await s3.putObject({
    Bucket:
      process.env.WHARFIE_ARTIFACT_BUCKET ||
      `${process.env.WHARFIE_DEPLOYMENT_NAME}-${Account}-${process.env.WHARFIE_REGION}`,
    Key: `wharfie/udf/${udf_name}/${label}.zip`,
    Body: await fs.promises.readFile(
      path.join(__dirname, `../../../dist/udf/${udf_name}/${label}/ouput.zip`)
    ),
  });

  displaySuccess('Build succeeded');
};

exports.command = 'build [udf_name] [entrypoint] [label]';
exports.desc = 'build wharfie udf artifact';
/**
 * @param {import('yargs').Argv} yargs -
 */
exports.builder = (yargs) => {
  yargs
    .positional('udf_name', {
      type: 'string',
      describe: 'name of udf',
    })
    .positional('entrypoint', {
      type: 'string',
      describe: 'entrypoint for udf',
    })
    .positional('label', {
      type: 'string',
      describe: 'build artifact prefix',
      optional: true,
    });
};
/**
 * @typedef udfBuildCLIParams
 * @property {string} udf_name -
 * @property {string} entrypoint -
 * @property {string} label -
 * @param {udfBuildCLIParams} params -
 */
exports.handler = async function ({ udf_name, entrypoint, label }) {
  try {
    await build(udf_name, entrypoint, label);
  } catch (err) {
    displayFailure(err);
  }
};
