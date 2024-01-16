'use strict';
const { displayFailure } = require('../output.js');

const Athena = require('../../lambdas/lib/athena/index.js');
const { getAllResources } = require('../../lambdas/lib/dynamo/resource.js');
const view = async () => {
  const athena = new Athena();

  const resources = await getAllResources();

  const wharfie_resources = resources.map((resource) => {
    const name = `${resource.destination_properties.DatabaseName}.${resource.destination_properties.TableInput.Name}`;
    const dependsOn = [];
    if (resource.source_properties.TableInput.TableType === 'VIRTUAL_VIEW') {
      const viewOriginalText =
        resource.source_properties.TableInput.ViewOriginalText;
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
exports.desc = 'output project resource dependencies';
exports.builder = (yargs) => {};
exports.handler = async function () {
  try {
    await view();
  } catch (err) {
    displayFailure(err);
  }
};
