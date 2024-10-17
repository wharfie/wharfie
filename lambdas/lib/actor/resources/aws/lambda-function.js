'use strict';
const Lambda = require('../../../lambda');
const BaseResource = require('../base-resource');
const { ResourceNotFoundException } = require('@aws-sdk/client-lambda');
/**
 * @typedef LambdaProperties
 * @property {import('@aws-sdk/client-lambda').Runtime} runtime -
 * @property {string | function(): string} role -
 * @property {string} handler -
 * @property {any | function} code -
 * @property {any} description -
 * @property {number} [memorySize] -
 * @property {number} [timeout] -
 * @property {boolean} [publish] -
 * @property {string} [packageType] -
 * @property {import('@aws-sdk/client-lambda').Architecture[]} [architectures] -
 * @property {any} [ephemeralStorage] -
 * @property {any | function} [environment] -
 * @property {any | function} [deadLetterConfig] -
 * @property {Record<string, string>} [tags] -
 * @property {string | function(): string} codeHash -
 */

/**
 * @typedef LambdaOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {LambdaProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class LambdaFunction extends BaseResource {
  /**
   * @param {LambdaOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    const propertiesWithDefaults = Object.assign(
      {
        runtime: 'nodejs20.x',
        handler: 'index.handler',
        memorySize: 128,
        timeout: 300,
        publish: true,
        packageType: 'Zip',
        architectures: ['arm64'],
        ephemeralStorage: { Size: 512 },
        environment: {
          Variables: {
            NODE_OPTIONS: '--enable-source-maps',
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
          },
        },
      },
      properties
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
    });
    this.lambda = new Lambda({});
  }

  /**
   * @param {Object<any,string>} a -
   * @param {Object<any,string>} b -
   * @returns {boolean} -
   */
  _diffEnvironment(a, b) {
    const mapA = new Map(Object.entries(a));
    const mapB = new Map(Object.entries(b));

    for (const [key, value] of mapA) {
      if (!mapB.has(key) || mapB.get(key) !== value) {
        return true;
      }
    }
    return false;
  }

  async _reconcileTags() {
    const { Tags } = await this.lambda.listTags({
      Resource: this.get('arn'),
    });
    const currentTags = Tags || {};
    const desiredTags = Object.assign(
      {
        CodeHash: this.get('codeHash'),
      },
      this.get('tags', {})
    );

    const tagsToAdd = Object.entries(desiredTags).filter(
      ([key, value]) =>
        !Object.entries(currentTags).some(
          ([tagKey, tagValue]) => tagKey === key && tagValue === value
        )
    );
    const tagsToRemove = Object.entries(currentTags).filter(
      ([key, value]) =>
        !Object.entries(desiredTags).some(
          ([tagKey, tagValue]) => tagKey === key && tagValue === value
        )
    );

    if (tagsToAdd.length > 0) {
      await this.lambda.tagResource({
        Resource: this.get('arn'),
        Tags: Object.fromEntries(tagsToAdd),
      });
    }
    if (tagsToRemove.length > 0) {
      await this.lambda.untagResource({
        Resource: this.get('arn'),
        TagKeys: Object.keys(Object.fromEntries(tagsToRemove)),
      });
    }
  }

  async _reconcile() {
    try {
      const { Configuration, Tags } = await this.lambda.getFunction({
        FunctionName: this.name,
      });
      this.set('arn', Configuration?.FunctionArn);
      if (
        this.get('role') !== Configuration?.Role ||
        this.get('runtime') !== Configuration?.Runtime ||
        this.get('handler') !== Configuration?.Handler ||
        this.get('description') !== Configuration?.Description ||
        this.get('timeout') !== Configuration?.Timeout ||
        this.get('memorySize') !== Configuration?.MemorySize ||
        this.get('ephemeralStorage').Size !==
          Configuration?.EphemeralStorage?.Size ||
        this._diffEnvironment(
          this.get('environment').Variables || {},
          Configuration?.Environment?.Variables || {}
        ) ||
        this.get('deadLetterConfig').TargetArn !==
          Configuration?.DeadLetterConfig?.TargetArn
      ) {
        await this.lambda.updateFunctionConfiguration({
          FunctionName: this.name,
          Role: this.get('role'),
          Handler: this.get('handler'),
          Description: this.get('description'),
          Timeout: this.get('timeout'),
          MemorySize: this.get('memorySize'),
          EphemeralStorage: this.get('ephemeralStorage'),
          Environment: this.get('environment'),
          DeadLetterConfig: this.get('deadLetterConfig'),
        });
      }
      if (this.get('codeHash') !== Tags?.CodeHash) {
        await this.lambda.updateFunctionCode({
          FunctionName: this.name,
          Publish: this.get('publish'),
          Architectures: this.get('architectures'),
          ...this.get('code'),
        });
        await this.lambda.tagResource({
          Resource: this.get('arn'),
          Tags: {
            CodeHash: this.get('codeHash'),
          },
        });
      }
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        const { FunctionArn } = await this.lambda.createFunction({
          FunctionName: this.name,
          Runtime: this.get('runtime'),
          Role: this.get('role'),
          Handler: this.get('handler'),
          Code: this.get('code'),
          Description: this.get('description'),
          MemorySize: this.get('memorySize'),
          Timeout: this.get('timeout'),
          Publish: this.get('publish'),
          PackageType: this.get('packageType'),
          Architectures: this.get('architectures'),
          EphemeralStorage: this.get('ephemeralStorage'),
          Environment: this.get('environment'),
          DeadLetterConfig: this.get('deadLetterConfig'),
          Tags: {
            ...this.get('tags', {}),
            CodeHash: this.get('codeHash'),
          },
        });
        this.set('arn', FunctionArn);
      } else {
        throw error;
      }
    }
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      await this.lambda.deleteFunction({
        FunctionName: this.name,
      });
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }
  }
}

module.exports = LambdaFunction;
