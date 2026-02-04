import BaseResourceGroup from './base-resource-group.js';
import Reconcilable from './reconcilable.js';
import WharfieResource from './wharfie-resource.js';

import GlueDatabase from './aws/glue-database.js';
import Bucket from './aws/bucket.js';
import Role from './aws/role.js';
import S3 from '../../s3.js';

/**
 * @typedef WharfieProjectProperties
 * @property {string} eventsQueueArn - eventsQueueArn.
 * @property {string[]} actorRoleArns - actorRoleArns.
 * @property {string} deploymentSharedPolicyArn - deploymentSharedPolicyArn.
 * @property {string} scheduleQueueArn - scheduleQueueArn.
 * @property {string} scheduleQueueUrl - scheduleQueueUrl.
 * @property {string} daemonQueueUrl - daemonQueueUrl.
 * @property {string} scheduleRoleArn - scheduleRoleArn.
 * @property {string} operationTable - operationTable.
 * @property {string} dependencyTable - dependencyTable.
 * @property {string} locationTable - locationTable.
 * @property {number} [createdAt] - createdAt.
 */

/**
 * @typedef WharfieProjectOptions
 * @property {import('../wharfie-deployment.js').default} [deployment] - deployment.
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('./reconcilable.js').default.Status} [status] - status.
 * @property {WharfieProjectProperties & import('../typedefs.js').SharedProperties} [properties] - properties.
 * @property {import('./reconcilable.js').default[]} [dependsOn] - dependsOn.
 * @property {Object<string, import('./base-resource.js').default | BaseResourceGroup>} [resources] - resources.
 */

class WharfieProject extends BaseResourceGroup {
  /**
   * @param {WharfieProjectOptions} options - options.
   */
  constructor({
    deployment,
    name,
    parent,
    status,
    properties,
    dependsOn,
    resources,
  }) {
    const propertiesWithDefaults = Object.assign(
      deployment
        ? {
            deployment: deployment.get('deployment'),
          }
        : {},
      {
        project: { name },
        createdAt: Date.now(),
      },
      properties,
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
      resources,
    });
    this.s3 = new S3();
    /**
     * @type {Object<string, import('./aws/events-rule.js')>} -
     */
    this.eventRules = {};

    if (deployment) {
      // if not deserialized this is required
      this.set('eventsQueueArn', () =>
        // @ts-ignore
        deployment.getEventsActor().getQueue().get('arn'),
      );
      this.set('scheduleQueueArn', () =>
        // @ts-ignore
        deployment.getEventsActor().getQueue().get('arn'),
      );
      this.set('scheduleQueueUrl', () =>
        // @ts-ignore
        deployment.getEventsActor().getQueue().get('url'),
      );
      this.set('daemonQueueUrl', () =>
        // @ts-ignore
        deployment.getDaemonActor().getQueue().get('url'),
      );
      this.set('scheduleRoleArn', () =>
        deployment
          .getDeploymentResources()
          .getResource(`${deployment.name}-event-role`)
          .get('arn'),
      );
      this.set(
        'deploymentSharedPolicyArn',
        deployment
          .getDeploymentResources()
          .getResource(`${deployment.name}-shared-policy`)
          .get('arn'),
      );
      this.set('actorRoleArns', () =>
        deployment.getActors().map(
          // @ts-ignore
          (actor) => actor.getRole().get('arn'),
        ),
      );
      this.set('scheduleRoleArn', () =>
        deployment
          .getDeploymentResources()
          .getResource(`${deployment.name}-event-role`)
          .get('arn'),
      );
      this.set('deployment', deployment.getDeploymentProperties());
      this.set('operationTable', `${deployment.name}-operations`);
      this.set('dependencyTable', `${deployment.name}-dependencies`);
      this.set('locationTable', `${deployment.name}-locations`);
    }
  }

  /**
   * @returns {import('../typedefs.js').ProjectEnvironmentProperties} - Result.
   */
  _getProjectProperties() {
    return {
      name: this.name,
    };
  }

  /**
   * @param {string} parent - parent.
   * @returns {(import('./base-resource.js').default | BaseResourceGroup)[]} - Result.
   */
  _defineGroupResources(parent) {
    const database = new GlueDatabase({
      name: `${this.name}`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        project: this._getProjectProperties(),
      },
    });
    const bucket = new Bucket({
      name: `${this.name.replace(/[\s_]/g, '-')}-bucket`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        project: this._getProjectProperties(),
        lifecycleConfiguration: {
          Rules: [
            {
              ID: 'abort_incomplete_multipart_uploads',
              // Prefix is required but not documented https://github.com/boto/boto3/issues/1126#issuecomment-309147443
              Prefix: '',
              AbortIncompleteMultipartUpload: {
                DaysAfterInitiation: 1,
              },
              Status: 'Enabled',
            },
          ],
        },
        notificationConfiguration: () => ({
          QueueConfigurations: [
            {
              Events: ['s3:ObjectCreated:*'],
              QueueArn: this.get('eventsQueueArn'),
            },
            {
              Events: ['s3:ObjectRemoved:*'],
              QueueArn: this.get('eventsQueueArn'),
            },
          ],
        }),
      },
    });
    const role = new Role({
      name: `${this.name}-project-role`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        project: this._getProjectProperties(),
        description: `${this.name} project role`,
        assumeRolePolicyDocument: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                AWS: this.get('actorRoleArns'),
              },
            },
          ],
        }),
        managedPolicyArns: () => [this.get('deploymentSharedPolicyArn')],
        rolePolicyDocument: () => {
          const inputLocationsArray = this.getInputLocations();
          const outputLocationsArray = this.getOutputLocations();
          if (
            inputLocationsArray.length === 0 &&
            outputLocationsArray.length === 0
          ) {
            return undefined;
          }
          return {
            Version: '2012-10-17',
            Statement: [
              ...(inputLocationsArray.length > 0 ||
              outputLocationsArray.length > 0
                ? [
                    {
                      Sid: 'Bucket',
                      Effect: 'Allow',
                      Action: [
                        's3:GetBucketLocation',
                        's3:GetBucketAcl',
                        's3:ListBucket',
                        's3:ListBucketMultipartUploads',
                        's3:AbortMultipartUpload',
                      ],
                      Resource: [
                        ...inputLocationsArray.map(
                          (location) =>
                            `arn:aws:s3:::${
                              this.s3.parseS3Uri(location).bucket
                            }`,
                        ),
                        ...outputLocationsArray.map(
                          (location) =>
                            `arn:aws:s3:::${
                              this.s3.parseS3Uri(location).bucket
                            }`,
                        ),
                      ],
                    },
                  ]
                : []),
              ...(outputLocationsArray.length > 0
                ? [
                    {
                      Sid: 'OutputWrite',
                      Effect: 'Allow',
                      Action: ['s3:*'],
                      Resource: outputLocationsArray.map(
                        (location) => `${this.s3.parseS3Uri(location).arn}*`,
                      ),
                    },
                  ]
                : []),
              ...(inputLocationsArray.length > 0
                ? [
                    {
                      Sid: 'InputRead',
                      Effect: 'Allow',
                      Action: ['s3:GetObject'],
                      Resource: inputLocationsArray.map(
                        (location) => `${this.s3.parseS3Uri(location).arn}*`,
                      ),
                    },
                  ]
                : []),
            ],
          };
        },
      },
    });
    return [database, bucket, role];
  }

  /**
   * @param {UserDefinedWharfieResourceOptions} options - options.
   * @returns {import('./wharfie-resource.js').WharfieResourceProperties & import('../typedefs.js').SharedProperties} - Result.
   */
  assembleResourceProperties(options) {
    return {
      ...WharfieResource.DefaultProperties,
      ...options.properties,
      deployment: () => this.get('deployment'),
      project: this._getProjectProperties(),
      resourceName: options.name,
      resourceId: `${this.name}.${options.name}`,
      projectName: this.name,
      databaseName: this.name,
      outputLocation: `s3://${this.getBucket().get('bucketName')}/${
        options.name
      }/`,
      projectBucket: this.getBucket().get('bucketName'),
      region: this.get('deployment').region,
      catalogId: this.get('deployment').accountId,
      scheduleQueueArn: this.get('scheduleQueueArn'),
      scheduleQueueUrl: this.get('scheduleQueueUrl'),
      daemonQueueUrl: this.get('daemonQueueUrl'),
      scheduleRoleArn: this.get('scheduleRoleArn'),
      roleArn: () => this.getRole().get('arn'),
      operationTable: this.get('operationTable'),
      dependencyTable: this.get('dependencyTable'),
      locationTable: this.get('locationTable'),
      createdAt: this.get('createdAt'),
    };
  }

  /**
   * @param {UserDefinedWharfieResourceOptions} options - options.
   */
  addWharfieResource(options) {
    const name = `${options.name}-resource`;
    const newProperties = this.assembleResourceProperties(options);
    if (this.resources[name]) {
      if (!(this.resources[name] instanceof WharfieResource)) {
        throw new Error(`${name} cannot be used for a wharfie resource name`);
      }
      if (!this.resources[name].checkPropertyEquality(newProperties)) {
        this.resources[name].properties = newProperties;
        this.resources[name].setStatus(Reconcilable.Status.DRIFTED);
        this.setStatus(Reconcilable.Status.DRIFTED);
        this.getRole().setStatus(Reconcilable.Status.DRIFTED);
      }
    } else {
      this.addResource(
        new WharfieResource({
          ...options,
          name,
          parent: this.getName(),
          dependsOn: [this.getRole(), this.getBucket()],
          properties: newProperties,
        }),
      );
      this.setStatus(Reconcilable.Status.DRIFTED);
      this.getRole().setStatus(Reconcilable.Status.DRIFTED);
    }
  }

  /**
   * @param {string} name - name.
   */
  removeWharfieResource(name) {
    if (!this.resources[`${name}-resource`]) return;
    if (!(this.resources[`${name}-resource`] instanceof WharfieResource))
      throw new Error('cannot remove non-wharfie resource');
    this.resources[`${name}-resource`].markForDestruction();
    this.setStatus(Reconcilable.Status.DRIFTED);
    this.getRole().setStatus(Reconcilable.Status.DRIFTED);
  }
  /**
   * @typedef UserDefinedWharfieResourceProperties
   * @property {string} description - description.
   * @property {string} tableType - tableType.
   * @property {any} parameters - parameters.
   * @property {import('../typedefs.js').WharfieTableColumn[]} partitionKeys - partitionKeys.
   * @property {import('../typedefs.js').WharfieTableColumn[]} columns - columns.
   * @property {string} [inputFormat] - inputFormat.
   * @property {string} [outputFormat] - outputFormat.
   * @property {any} [serdeInfo] - serdeInfo.
   * @property {any[]} [tags] - tags.
   * @property {string} [inputLocation] - inputLocation.
   * @property {number} [numberOfBuckets] - numberOfBuckets.
   * @property {boolean} [storedAsSubDirectories] - storedAsSubDirectories.
   * @property {boolean} [compressed] - compressed.
   * @property {string} [viewOriginalText] - viewOriginalText.
   * @property {string} [viewExpandedText] - viewExpandedText.
   * @property {import('../../../../cli/project/typedefs.js').Model | import('../../../../cli/project/typedefs.js').Source} userInput - userInput.
   */
  /**
   * @typedef UserDefinedWharfieResourceOptions
   * @property {string} name - name.
   * @property {UserDefinedWharfieResourceProperties} properties - properties.
   */

  /**
   * @param {UserDefinedWharfieResourceOptions[]} resourceOptions - resourceOptions.
   */
  registerWharfieResources(resourceOptions) {
    /** @type {Object<string,UserDefinedWharfieResourceOptions>} */
    const resourceOptionsMap = resourceOptions.reduce((acc, option) => {
      // @ts-ignore
      acc[`${option.name}-resource`] = option;
      return acc;
    }, {});

    this.getWharfieResources().forEach((resource) => {
      if (!resourceOptionsMap[resource.name]) {
        if (resource.isDestroyed()) {
          delete this.resources[resource.name];
        } else {
          resource.markForDestruction();
          this.setStatus(Reconcilable.Status.DRIFTED);
          this.getRole().setStatus(Reconcilable.Status.DRIFTED);
        }
      } else {
        const opts = resourceOptionsMap[resource.name];
        Object.keys(opts.properties).forEach((key) => {
          // @ts-ignore
          this.resources[resource.name].set(key, opts.properties[key]);
        });
        delete resourceOptionsMap[resource.name];
        this.setStatus(Reconcilable.Status.DRIFTED);
        this.getRole().setStatus(Reconcilable.Status.DRIFTED);
      }
    });
    Object.values(resourceOptionsMap).forEach((options) => {
      this.addWharfieResource(options);
    });
  }

  /**
   * @typedef WharfieResourceDiff
   * @property {import('../../../../cli/project/typedefs.js').Model | import('../../../../cli/project/typedefs.js').Source} old - old.
   * @property {import('../../../../cli/project/typedefs.js').Model | import('../../../../cli/project/typedefs.js').Source} new - new.
   * @property {import('jsondiffpatch').Delta} delta - delta.
   */

  /**
   * @typedef WharfieProjeceDiffs
   * @property {Object<string,import('../../../../cli/project/typedefs.js').Model | import('../../../../cli/project/typedefs.js').Source>} additions - additions.
   * @property {Object<string,import('../../../../cli/project/typedefs.js').Model | import('../../../../cli/project/typedefs.js').Source>} removals - removals.
   * @property {Object<string,WharfieResourceDiff>} updates - updates.
   */

  /**
   * @param {UserDefinedWharfieResourceOptions[]} resourceOptions - resourceOptions.
   * @returns {WharfieProjeceDiffs} - Result.
   */
  diffWharfieResources(resourceOptions) {
    /** @type {WharfieProjeceDiffs} */
    const diffs = {
      additions: {},
      removals: {},
      updates: {},
    };
    const newResourceNames = resourceOptions.reduce((acc, option) => {
      acc.add(option.name);
      return acc;
    }, new Set());
    const existingResources = this.getWharfieResources();
    const existingResourceNames = existingResources.reduce((acc, option) => {
      acc.add(option.get('resourceName'));
      return acc;
    }, new Set());
    existingResources.forEach((resource) => {
      if (!newResourceNames.has(resource.get('resourceName'))) {
        diffs.removals[resource.get('resourceName')] =
          resource.get('userInput');
      }
    });
    resourceOptions.forEach((options) => {
      if (!existingResourceNames.has(options.name)) {
        diffs.additions[options.name] = options.properties.userInput;
      } else {
        const existingResource = this.resources[`${options.name}-resource`];
        const diff = existingResource.diffProperty(
          'userInput',
          options.properties.userInput,
        );
        if (diff.delta) {
          diffs.updates[options.name] = {
            old: diff.old,
            new: diff.new,
            delta: diff.delta,
          };
        }
      }
    });
    return diffs;
  }

  /**
   * @returns {WharfieResource[]} - Result.
   */
  getWharfieResources() {
    // @ts-ignore
    return this.getResources().filter(
      (resource) => resource instanceof WharfieResource,
    );
  }

  /**
   * @returns {String[]} - Result.
   */
  getOutputLocations() {
    const outputLocations = new Set();
    this.getWharfieResources().forEach(
      (resource) =>
        resource.has('outputLocation') &&
        outputLocations.add(resource.get('outputLocation')),
    );
    return Array.from(outputLocations);
  }

  /**
   * @returns {String[]} - Result.
   */
  getInputLocations() {
    const inputLocations = new Set();
    this.getWharfieResources().forEach(
      (resource) =>
        resource.has('inputLocation') &&
        inputLocations.add(resource.get('inputLocation')),
    );
    return Array.from(inputLocations);
  }

  getBucket() {
    return this.getResource(`${this.name.replace(/[\s_]/g, '-')}-bucket`);
  }

  getRole() {
    return this.getResource(`${this.name}-project-role`);
  }
}

export default WharfieProject;
