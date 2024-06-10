'use strict';
const Lambda = require('../../../lambda');
const BaseResource = require('../base-resource');
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
 * @property {string | function(): string} codeHash -
 */

/**
 * @typedef LambdaOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {LambdaProperties & import('../../typedefs').SharedDeploymentProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class LambdaFunction extends BaseResource {
  /**
   * @param {LambdaOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
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
    super({ name, status, properties: propertiesWithDefaults, dependsOn });
    this.lambda = new Lambda({});
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
        // JSON.stringify(
        //   this.environment === 'function'
        //     ? this.environment()
        //     : this.environment
        // ) !== JSON.stringify(Configuration?.Environment) ||
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
      // @ts-ignore
      if (error.name === 'ResourceNotFoundException') {
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
            CodeHash: this.get('codeHash'),
          },
        });
        this.set('arn', FunctionArn);
      } else {
        throw error;
      }
    }
  }

  async _destroy() {
    try {
      await this.lambda.deleteFunction({
        FunctionName: this.name,
      });
    } catch (error) {
      // @ts-ignore
      if (error.name !== 'ResourceNotFoundException') throw error;
    }
  }
}

module.exports = LambdaFunction;
