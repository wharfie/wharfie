'use strict';
const { displayFailure } = require('../../output/basic');

const Athena = require('../../../lambdas/lib/athena/index.js/index.js');
const { getAllResources } = require('../../../lambdas/lib/dynamo/resource.js');
const view = async () => {
  const athena = new Athena({});

  const resources = await getAllResources();

  const wharfie_resources = resources.map((resource) => {
    const name = `${resource.destination_properties.databaseName}.${resource.destination_properties.name}`;
    /**
     * @type {string[]}
     */
    const dependsOn = [];
    if (resource.source_properties.tableType === 'VIRTUAL_VIEW') {
      const viewOriginalText =
        resource.source_properties.viewOriginalText || '';
      const view_sql = JSON.parse(
        Buffer.from(
          viewOriginalText.substring(16, viewOriginalText.length - 3),
          'base64'
        ).toString()
      ).originalSql;
      const { sources } = athena.extractSources(view_sql);
      sources.forEach((source) => {
        if (!source.DatabaseName || !source.TableName) return;
        dependsOn.push(`${source.DatabaseName}.${source.TableName}`);
      });
    }
    return {
      name,
      dependsOn,
      description: resource.destination_properties.description,
      metadata: {
        wharfie_resource_id: resource.resource_id,
        location: resource.destination_properties.location,
      },
    };
  });
  console.log(
    JSON.stringify(
      {
        resources: wharfie_resources,
      },
      null,
      2
    )
  );
};

exports.command = 'dependency_list';
exports.desc = "output deployment's resource dependencies";
exports.builder = () => {};
exports.handler = async function () {
  try {
    await view();
  } catch (err) {
    displayFailure(err);
  }
};
