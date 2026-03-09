import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');
const { displayFailure } = require('../../output/basic');
const Athena = require('../../../lambdas/lib/aws/athena/index.js').default;
const {
  getAllResources,
} = require('../../../lambdas/lib/aws/dynamo/operations.js');

const view = async () => {
  const athena = new Athena({});
  const resources = await getAllResources();

  const wharfieResources = resources.map(
    /**
     * @param {{ destination_properties: any, source_properties: any, id: string }} resource - Resource to describe.
     * @returns {{
     *   name: string,
     *   dependsOn: string[],
     *   description: any,
     *   metadata: { wharfie_resource_id: string, location: any },
     * }} - Serialized dependency description.
     */
    (resource) => {
      const name = `${resource.destination_properties.databaseName}.${resource.destination_properties.name}`;
      /**
       * @type {string[]}
       */
      const dependsOn = [];

      if (resource.source_properties.tableType === 'VIRTUAL_VIEW') {
        const viewOriginalText =
          resource.source_properties.viewOriginalText || '';
        const viewSql = JSON.parse(
          Buffer.from(
            viewOriginalText.substring(16, viewOriginalText.length - 3),
            'base64',
          ).toString(),
        ).originalSql;

        const { sources } = athena.extractSources(viewSql);
        sources.forEach(
          /** @param {{ DatabaseName?: string, TableName?: string }} source */
          (source) => {
            if (source.DatabaseName && source.TableName) {
              dependsOn.push(`${source.DatabaseName}.${source.TableName}`);
            }
          },
        );
      }

      return {
        name,
        dependsOn,
        description: resource.destination_properties.description,
        metadata: {
          wharfie_resource_id: resource.id,
          location: resource.destination_properties.location,
        },
      };
    },
  );

  console.log(
    JSON.stringify(
      {
        resources: wharfieResources,
      },
      null,
      2,
    ),
  );
};

const dependencyListCommand = new Command('dependency_list')
  .description("Output deployment's resource dependencies")
  .action(async () => {
    try {
      await view();
    } catch (err) {
      displayFailure(err);
    }
  });

module.exports = dependencyListCommand;
