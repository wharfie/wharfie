'use strict';
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const { NotFound } = require('@aws-sdk/client-s3');
const { createRequire } = require('module');
const requireFromExecutable = createRequire(__filename);
const { getAsset, isSea } = require('node:sea');

// Statically import all known handlers
/**
 * @type {Object<string,string>}
 */
const HANDLERS = {
  '<WHARFIE_BUILT_IN>/daemon.handler': isSea()
    ? getAsset('<WHARFIE_BUILT_IN>/daemon.handler', 'utf8')
    : path.resolve(__dirname, '../../../../daemon.handler'),
  '<WHARFIE_BUILT_IN>/cleanup.handler': isSea()
    ? getAsset('<WHARFIE_BUILT_IN>/cleanup.handler', 'utf8')
    : path.resolve(__dirname, '../../../../cleanup.handler'),
  '<WHARFIE_BUILT_IN>/events.handler': isSea()
    ? getAsset('<WHARFIE_BUILT_IN>/events.handler', 'utf8')
    : path.resolve(__dirname, '../../../../events.handler'),
  '<WHARFIE_BUILT_IN>/monitor.handler': isSea()
    ? getAsset('<WHARFIE_BUILT_IN>/monitor.handler', 'utf8')
    : path.resolve(__dirname, '../../../../monitor.handler'),
};

const S3 = require('../../../s3');
const BaseResource = require('../base-resource');

/**
 * @typedef LambdaBuildProperties
 * @property {string | function(): string} handler -
 * @property {string | function(): string} artifactBucket -
 */

/**
 * @typedef LambdaBuildOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {LambdaBuildProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class LambdaBuild extends BaseResource {
  /**
   * @param {LambdaBuildOptions} options -
   */
  constructor({ name, parent, status, dependsOn = [], properties }) {
    super({ name, parent, status, properties, dependsOn });
    this.s3 = new S3({});
  }

  async _reconcile() {
    if (!this.get('handler')) throw new Error('No handler defined');
    if (!this.get('handler').split('.').pop())
      throw new Error('No handler method defined');

    // Lookup and set the handler based on metadata
    const resolvedHandlerKey = this.get('handler');
    const builtInHandler = HANDLERS[resolvedHandlerKey];

    const build = isSea()
      ? builtInHandler
      : await this._build(builtInHandler || resolvedHandlerKey);

    // The bundled code is available in `result.outputFiles`
    const functionCodeHash = crypto
      .createHash('sha256')
      .update(build)
      .digest('hex');

    this.set(
      'artifactKey',
      `actor-artifacts/${this.name}/${functionCodeHash}.zip`
    );

    this.set('functionCodeHash', functionCodeHash);

    try {
      await this.s3.headObject({
        Bucket: this.get('artifactBucket'),
        Key: this.get('artifactKey'),
      });
      return;
    } catch (error) {
      if (!(error instanceof NotFound)) {
        throw error;
      }
    }

    const stream = await this._zip([{ text: build, path: 'index.js' }]);

    await this.s3.putObject({
      Bucket: this.get('artifactBucket'),
      Key: this.get('artifactKey'),
      Body: stream,
    });
  }

  /**
   * Compresses files into a ZIP archive from provided file data.
   * @param {Object[]} files - An array of objects representing files,
   *                           each with a `path` and `contents`.
   *                           Example: [{ path: 'folder1/file1.txt', contents: 'Hello World' }]
   * @returns {Promise<Buffer>} - A Promise resolving to a Buffer containing the ZIP archive.
   */
  async _zip(files) {
    const zipInstance = new JSZip();

    // Loop over provided files
    // @ts-ignore
    for (const { path, text } of files) {
      // Add file content to the ZIP instance using its path
      zipInstance.file(path, text);
    }

    // Generate the ZIP archive as a Buffer
    return await zipInstance.generateAsync({
      type: 'nodebuffer',
      streamFiles: true,
    });
  }

  /**
   * @param {string} handler -
   * @returns {Promise<string>} -
   */
  async _build(handler) {
    const requirePathParts = handler.split('.');
    const functionName = requirePathParts.pop();
    const requirePath = requirePathParts.join('.');
    const handlerContent = `
    const { ${functionName}: handler } = require('${requirePath}');
    // Lambda handler setup to use actor's handler method
    exports.handler = handler
    `;
    const esbuild = requireFromExecutable('esbuild');
    const result = await esbuild.build({
      stdin: {
        contents: handlerContent,
        resolveDir: path.dirname(requirePath),
        sourcefile: 'index.js',
        loader: 'js',
      },
      bundle: true,
      minify: true,
      keepNames: true,
      sourcemap: 'inline',
      platform: 'node',
      target: 'node22',
      write: false, // Prevent writing to disk
    });
    return result.outputFiles[0].text;
  }

  async _destroy() {}
}

module.exports = LambdaBuild;
