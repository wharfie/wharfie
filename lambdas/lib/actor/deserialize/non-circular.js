import { deserialize } from './shared.js';

import AthenaWorkGroup from '../resources/aws/athena-workgroup.js';
import AutoscalingPolicy from '../resources/aws/autoscaling-policy.js';
import AutoscalingTable from '../resources/aws/autoscaling-table.js';
import AutoscalingTarget from '../resources/aws/autoscaling-target.js';
import Bucket from '../resources/aws/bucket.js';
import EventSourceMapping from '../resources/aws/event-source-mapping.js';
import EventsRule from '../resources/aws/events-rule.js';
import Firehose from '../resources/aws/firehose.js';
import GlueDatabase from '../resources/aws/glue-database.js';
import GlueTable from '../resources/aws/glue-table.js';
import Policy from '../resources/aws/policy.js';
import Queue from '../resources/aws/queue.js';
import Role from '../resources/aws/role.js';
import Table from '../resources/aws/table.js';
import BucketNotificationConfiguration from '../resources/aws/bucket-notification-configuration.js';

import RecordResources from '../resources/records/index.js';
import { getResources } from '../../db/state/store.js';

/**
 * @typedef {new (options: any) => import('../resources/base-resource.js').default} ResourceConstructor
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
);

/**
 * @typedef WharfieDeploymentLoadOptions
 * @property {string} deploymentName - deploymentName.
 * @property {string} [resourceKey] - resourceKey.
 */
/**
 * @param {WharfieDeploymentLoadOptions} options - options.
 * @returns {Promise<any>} - Result.
 */
async function load({ deploymentName, resourceKey }) {
  if (!resourceKey) {
    resourceKey = deploymentName;
  }
  const serializedResources = await getResources(deploymentName, resourceKey);
  if (!serializedResources || serializedResources.length === 0) {
    throw new Error('No resource found');
  }
  // @ts-ignore
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
    NON_CIRCULAR_CLASS_MAP,
  );
}

export { load };
