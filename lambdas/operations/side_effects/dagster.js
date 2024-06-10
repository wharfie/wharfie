'use strict';

const https = require('https');
const logging = require('../../lib/logging');

const organization = process.env.SIDE_EFFECT_DAGSTER_ORGANIZATION || '';
const deployment = process.env.SIDE_EFFECT_DAGSTER_DEPLOYMENT || '';
const token = process.env.SIDE_EFFECT_DAGSTER_TOKEN || '';

/**
 * @param {import('../../typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @returns {Promise<import('../../typedefs').ActionProcessingOutput>} -
 */
async function dagster(event, context, resource, operation) {
  const event_log = logging.getEventLogger(event, context);
  const { completed_at } = event.action_inputs;
  if (!completed_at)
    throw new Error('missing required action inputs for dagster side effect');
  if (organization === '' || deployment === '' || token === '') {
    event_log.warn('Dagster environment variables not set');
    return {
      status: 'COMPLETED',
    };
  }
  if (organization === '' || deployment === '' || token === '') {
    event_log.warn('Dagster environment variables not set');
    return {
      status: 'COMPLETED',
    };
  }
  const databaseName = resource.destination_properties.databaseName;
  const tableName = resource.destination_properties.name;
  const asset_key = `${databaseName}.${tableName}`;
  const url = `https://${organization}.dagster.cloud/${deployment}/report_asset_materialization/?asset_key=${asset_key}`;
  const payload = JSON.stringify({
    metadata: {
      source: 'Wharfie',
      operation_id: operation.operation_id,
      operation_type: operation.operation_type,
      duration: completed_at - operation.started_at,
    },
  });

  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Dagster-Cloud-Api-Token': token,
    },
  };

  await new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(data);
        } else {
          reject(
            new Error(`Request failed with status code: ${res.statusCode}`)
          );
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(payload);
    req.end();
  });

  return {
    status: 'COMPLETED',
  };
}

module.exports = dagster;
