'use strict';
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

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
 * @property {import('../reconcilable').Status} [status] -
 * @property {LambdaBuildProperties & import('../../typedefs').SharedDeploymentProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class LambdaBuild extends BaseResource {
  /**
   * @param {LambdaBuildOptions} options -
   */
  constructor({ name, status, dependsOn = [], properties }) {
    super({ name, status, dependsOn, properties });
    this.s3 = new S3({});
  }

  async _reconcile() {
    await this._build();
  }

  /**
   * @param {string} dir -
   * @returns {Promise<Buffer>} -
   */
  async _zip(dir) {
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
    return await zipInstance.generateAsync({
      type: 'nodebuffer',
      streamFiles: true,
    });
  }

  async _build() {
    if (!this.get('handler')) throw new Error('No handler defined');
    if (!this.get('handler').split('.').pop())
      throw new Error('No handler method defined');

    // TODO hydrate shared actor state generally
    const entryContent = `
    const { ${this.get('handler').split('.').pop()}: handler } = require('${
      this.get('handler').split('.')[0]
    }');

    // Lambda handler setup to use actor's handler method
    exports.handler = handler
    `;
    await esbuild.build({
      stdin: {
        contents: entryContent,
        resolveDir: __dirname,
        sourcefile: 'WharfieActorGeneratedEntrypoint.js',
        loader: 'js',
      },
      bundle: true,
      minify: true,
      sourcemap: 'inline',
      platform: 'node',
      target: 'node20',
      outfile: `./dist/${this.name}/index.js`,
    });

    const functionCodeHash = crypto
      .createHash('sha256')
      .update(
        fs.readFileSync(
          path.join(process.cwd(), `./dist/${this.name}/index.js`)
        )
      )
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
      // @ts-ignore
      if (error?.name !== 'NotFound') {
        throw error;
      }
    }

    const stream = await this._zip(
      path.join(process.cwd(), `./dist/${this.name}`)
    );

    await this.s3.putObject({
      Bucket: this.get('artifactBucket'),
      Key: this.get('artifactKey'),
      Body: stream,
    });
  }

  async _destroy() {}
}

module.exports = LambdaBuild;
