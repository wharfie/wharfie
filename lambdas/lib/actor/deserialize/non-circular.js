const AthenaWorkGroup = require('../resources/aws/athena-workgroup');
const AutoscalingPolicy = require('../resources/aws/autoscaling-policy');
const AutoscalingTable = require('../resources/aws/autoscaling-table');
const AutoscalingTarget = require('../resources/aws/autoscaling-target');
const Bucket = require('../resources/aws/bucket');
const EventSourceMapping = require('../resources/aws/event-source-mapping');
const EventsRule = require('../resources/aws/events-rule');
const Firehose = require('../resources/aws/firehose');
const GlueDatabase = require('../resources/aws/glue-database');
const GlueTable = require('../resources/aws/glue-table');
const Policy = require('../resources/aws/policy');
const Queue = require('../resources/aws/queue');
const Role = require('../resources/aws/role');
const Table = require('../resources/aws/table');
const BucketNotificationConfiguration = require('../resources/aws/bucket-notification-configuration');

const RecordResources = require('../resources/records');
const WharfieProject = require('../resources/wharfie-project');
const WharfieResource = require('../resources/wharfie-resource');
const { getResources } = require('../../dynamo/state');
const { deserialize } = require('./shared');

/**
 * @typedef {new (options: any) => import('../resources/base-resource')} ResourceConstructor
 */
/**
 * @type {Object<string, ResourceConstructor>}
 */
const NON_CIRCULAR_CLASS_MAP = Object.assign(
  {
    AthenaWorkGroup,
    AutoscalingPolicy,
    AutoscalingTable,
    AutoscalingTarget,
    Bucket,
    BucketNotificationConfiguration,
    EventSourceMapping,
    EventsRule,
    Firehose,
    GlueDatabase,
    GlueTable,
    Policy,
    Queue,
    Role,
    Table,
  },
  RecordResources,
  {
    WharfieProject,
    WharfieResource,
  }
);

/**
 * @typedef WharfieDeploymentLoadOptions
 * @property {string} deploymentName -
 * @property {string} [resourceKey] -
 */
/**
 * @param {WharfieDeploymentLoadOptions} options -
 * @returns {Promise<WharfieProject>} -
 */
async function load({ deploymentName, resourceKey }) {
  if (!resourceKey) {
    resourceKey = deploymentName;
  }
  const serializedResources = await getResources(deploymentName, resourceKey);
  if (!serializedResources || serializedResources.length === 0) {
    throw new Error('No resource found');
  }

  const resourceMap = serializedResources.slice(1).reduce((acc, item) => {
    // @ts-ignore
    acc[item.name] = item;
    return acc;
  }, {});
  // @ts-ignore
  return deserialize(
    // @ts-ignore
    serializedResources[0],
    resourceMap,
    NON_CIRCULAR_CLASS_MAP
  );
}

module.exports = {
  load,
};
