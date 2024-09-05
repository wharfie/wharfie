const BaseResourceGroup = require('./base-resource-group');
const Reconcilable = require('./reconcilable');
const WharfieResource = require('./wharfie-resource');
const GlueDatabase = require('./aws/glue-database');
const Bucket = require('./aws/bucket');
const Role = require('./aws/role');
const S3 = require('../../s3');
const { putWithThroughputRetry } = require('../../dynamo/');
const { createStableHash } = require('../../crypto');

/**
 * @typedef WharfieProjectProperties
 * @property {string} eventsQueueArn -
 * @property {string[]} actorRoleArns -
 * @property {string} deploymentSharedPolicyArn -
 * @property {string} scheduleQueueArn -
 * @property {string} scheduleRoleArn -
 * @property {string} resourceTable -
 * @property {string} dependencyTable -
 * @property {string} locationTable -
 */

/**
 * @typedef WharfieProjectOptions
 * @property {import('../wharfie-deployment')} [deployment] -
 * @property {string} name -
 * @property {import('./reconcilable').Status} [status] -
 * @property {WharfieProjectProperties & import('../typedefs').SharedProperties} [properties] -
 * @property {import('./reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./base-resource') | BaseResourceGroup>} [resources] -
 */

class WharfieProject extends BaseResourceGroup {
  /**
   * @param {WharfieProjectOptions} options -
   */
  constructor({ deployment, name, status, properties, dependsOn, resources }) {
    const propertiesWithDefaults = Object.assign(
      deployment
        ? {
            deployment: deployment.get('deployment'),
          }
        : {},
      {
        project: { name },
      },
      properties
    );
    super({
      name,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
      resources,
    });
    this.s3 = new S3();
    /**
     * @type {Object<string, import('./aws/events-rule')>} -
     */
    this.eventRules = {};

    if (deployment) {
      // if not deserialized this is required
      this.set('eventsQueueArn', () =>
        // @ts-ignore
        deployment.getEventsActor().getQueue().get('arn')
      );
      this.set('scheduleQueueArn', () =>
        // @ts-ignore
        deployment.getDaemonActor().getQueue().get('arn')
      );
      this.set('scheduleRoleArn', () =>
        deployment
          .getDeploymentResources()
          .getResource(`${deployment.name}-event-role`)
          .get('arn')
      );
      this.set(
        'deploymentSharedPolicyArn',
        deployment
          .getDeploymentResources()
          .getResource(`${deployment.name}-shared-policy`)
          .get('arn')
      );
      this.set('actorRoleArns', () =>
        deployment.getActors().map(
          // @ts-ignore
          (actor) => actor.getRole().get('arn')
        )
      );
      this.set('scheduleRoleArn', () =>
        deployment
          .getDeploymentResources()
          .getResource(`${deployment.name}-event-role`)
          .get('arn')
      );
      this.set('deployment', deployment.getDeploymentProperties());
      this.set('resourceTable', `${deployment.name}-resource`);
      this.set('dependencyTable', `${deployment.name}-dependencies`);
      this.set('locationTable', `${deployment.name}-locations`);
    }
  }

  /**
   * @returns {import('../typedefs').ProjectEnvironmentProperties} -
   */
  _getProjectProperties() {
    return {
      name: this.name,
    };
  }

  /**
   * @returns {(import('./base-resource') | BaseResourceGroup)[]} -
   */
  _defineGroupResources() {
    const database = new GlueDatabase({
      name: `${this.name}`,
      properties: {
        deployment: () => this.get('deployment'),
        project: this._getProjectProperties(),
      },
    });
    const bucket = new Bucket({
      name: `${this.name.replace(/[\s_]/g, '-')}-bucket-${createStableHash(
        this.name
      )}`,
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
                            }`
                        ),
                        ...outputLocationsArray.map(
                          (location) =>
                            `arn:aws:s3:::${
                              this.s3.parseS3Uri(location).bucket
                            }`
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
                        (location) => `${this.s3.parseS3Uri(location).arn}*`
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
                        (location) => `${this.s3.parseS3Uri(location).arn}*`
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
   * @param {UserDefinedWharfieResourceOptions} options -
   * @returns {import('./wharfie-resource').WharfieResourceProperties & import('../typedefs').SharedProperties} -
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
      outputLocation: `s3://${this.getBucket().name}/${options.name}/`,
      projectBucket: this.getBucket().name,
      region: this.get('deployment').region,
      catalogId: this.get('deployment').accountId,
      scheduleQueueArn: this.get('scheduleQueueArn'),
      scheduleRoleArn: this.get('scheduleRoleArn'),
      roleArn: () => this.getRole().get('arn'),
      resourceTable: this.get('resourceTable'),
      dependencyTable: this.get('dependencyTable'),
      locationTable: this.get('locationTable'),
    };
  }

  /**
   * @param {UserDefinedWharfieResourceOptions} options -
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
      }
    } else {
      this.addResource(
        new WharfieResource({
          ...options,
          name,
          dependsOn: [this.getRole(), this.getBucket()],
          properties: newProperties,
        })
      );
      this.setStatus(Reconcilable.Status.DRIFTED);
    }
  }

  /**
   * @param {string} name -
   */
  removeWharfieResource(name) {
    if (!this.resources[`${name}-resource`]) return;
    if (!(this.resources[`${name}-resource`] instanceof WharfieResource))
      throw new Error('cannot remove non-wharfie resource');
    this.resources[`${name}-resource`].markForDestruction();
    this.setStatus(Reconcilable.Status.DRIFTED);
  }
  /**
   * @typedef UserDefinedWharfieResourceProperties
   * @property {string} description -
   * @property {string} tableType -
   * @property {any} parameters -
   * @property {import('../typedefs').WharfieTableColumn[]} partitionKeys -
   * @property {import('../typedefs').WharfieTableColumn[]} columns -
   * @property {string} [inputFormat] -
   * @property {string} [outputFormat] -
   * @property {any} [serdeInfo] -
   * @property {any[]} [tags] -
   * @property {string} [inputLocation] -
   * @property {number} [numberOfBuckets] -
   * @property {boolean} [storedAsSubDirectories] -
   * @property {boolean} [compressed] -
   * @property {string} [viewOriginalText] -
   * @property {string} [viewExpandedText] -
   * @property {import('../../../../cli/project/typedefs').Model | import('../../../../cli/project/typedefs').Source} userInput -
   */
  /**
   * @typedef UserDefinedWharfieResourceOptions
   * @property {string} name -
   * @property {UserDefinedWharfieResourceProperties} properties -
   */

  /**
   * @param {UserDefinedWharfieResourceOptions[]} resourceOptions -
   */
  registerWharfieResources(resourceOptions) {
    const resourceNames = resourceOptions.reduce((acc, option) => {
      acc.add(`${option.name}-resource`);
      return acc;
    }, new Set());

    this.getWharfieResources().forEach((resource) => {
      if (!resourceNames.has(resource.name)) {
        if (resource.isDestroyed()) {
          delete this.resources[resource.name];
        } else {
          resource.markForDestruction();
          this.setStatus(Reconcilable.Status.DRIFTED);
        }
      }
    });
    resourceOptions.forEach((options) => {
      this.addWharfieResource(options);
    });
  }

  /**
   * @typedef WharfieResourceDiff
   * @property {import('../../../../cli/project/typedefs').Model | import('../../../../cli/project/typedefs').Source} old -
   * @property {import('../../../../cli/project/typedefs').Model | import('../../../../cli/project/typedefs').Source} new -
   * @property {import('jsondiffpatch').Delta} delta -
   */

  /**
   * @typedef WharfieProjeceDiffs
   * @property {Object<string,import('../../../../cli/project/typedefs').Model | import('../../../../cli/project/typedefs').Source>} additions -
   * @property {Object<string,import('../../../../cli/project/typedefs').Model | import('../../../../cli/project/typedefs').Source>} removals -
   * @property {Object<string,WharfieResourceDiff>} updates -
   */

  /**
   * @param {UserDefinedWharfieResourceOptions[]} resourceOptions -
   * @returns {WharfieProjeceDiffs} -
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
          options.properties.userInput
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
   * @returns {WharfieResource[]} -
   */
  getWharfieResources() {
    // @ts-ignore
    return this.getResources().filter(
      (resource) => resource instanceof WharfieResource
    );
  }

  /**
   * @returns {String[]} -
   */
  getOutputLocations() {
    const outputLocations = new Set();
    this.getWharfieResources().forEach(
      (resource) =>
        resource.has('outputLocation') &&
        outputLocations.add(resource.get('outputLocation'))
    );
    return Array.from(outputLocations);
  }

  /**
   * @returns {String[]} -
   */
  getInputLocations() {
    const inputLocations = new Set();
    this.getWharfieResources().forEach(
      (resource) =>
        resource.has('inputLocation') &&
        inputLocations.add(resource.get('inputLocation'))
    );
    return Array.from(inputLocations);
  }

  getBucket() {
    return this.getResource(
      `${this.name.replace(/[\s_]/g, '-')}-bucket-${createStableHash(
        this.name
      )}`
    );
  }

  getRole() {
    return this.getResource(`${this.name}-project-role`);
  }

  async save() {
    const { stateTable, version } = this.get('deployment');

    const serialized = this.serialize();
    await putWithThroughputRetry({
      TableName: stateTable,
      Item: {
        name: this.name,
        sort_key: this.name,
        serialized,
        status: this.status,
        version,
      },
      ReturnValues: 'NONE',
    });
  }
}

module.exports = WharfieProject;
