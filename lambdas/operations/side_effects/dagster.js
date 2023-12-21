'use strict';

const https = require('https');

const organization = process.env.DAGSTER_ORGANIZATION || '';
const deployment = process.env.DAGSTER_DEPLOYMENT || '';
const token = process.env.DAGSTER_TOKEN || '';

/**
 *
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @param {Number} completed_at -
 */
async function dagster(resource, operation, completed_at) {
  if (organization === '' || deployment === '' || token === '') {
    return;
  }
  const databaseName = resource.destination_properties.DatabaseName;
  const tableName = resource.destination_properties.TableInput.Name;
  const asset_key = `${databaseName}__${tableName}`;
  const url = `https://${organization}.dagster.cloud/${deployment}/report_asset_materialization/${asset_key}`;
  const payload = JSON.stringify({
    metadata: {
      source: 'Wharfie',
      operation_id: operation.operation_id,
      compelted_at: completed_at,
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
}

module.exports = dagster;
