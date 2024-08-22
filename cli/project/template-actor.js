const getTableInput = require('./formats');
const { validateModelSql, WharfieModelSQLError } = require('./model-validator');

/**
 * @typedef UserDefinedWharfieResourceProperties
 * @property {string} description -
 * @property {string} tableType -
 * @property {any} parameters -
 * @property {import('../../lambdas/lib/actor/typedefs').WharfieTableColumn[]} partitionKeys -
 * @property {import('../../lambdas/lib/actor/typedefs').WharfieTableColumn[]} columns -
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
 */
/**
 * @typedef UserDefinedWharfieResourceOptions
 * @property {string} name -
 * @property {UserDefinedWharfieResourceProperties} properties -
 */

/**
 * @param {import('./typedefs').Environment} environment -
 * @param {import('./typedefs').Project} project -
 * @returns {UserDefinedWharfieResourceOptions[]} -
 */
function getResourceOptions(environment, project) {
  /**
   * @type {Object<string,string>}
   */
  const SQLTemplateVariables = {
    ...environment.variables,
    db: project.name,
  };
  const resourceOptions = [];
  /**
   * @type {Object<string,string>}
   */
  const modelsForValidation = {};
  for (const model of project.models) {
    const templatedSQL = JSON.stringify({
      originalSql: model.sql,
      catalog: 'awsdatacatalog',
      columns: [
        ...model.columns.map((column) => ({
          name: column.name,
          type: column.type
            .replace(/:string/g, ':varchar')
            .replace(/^string/g, 'varchar')
            .replace(/:int/g, ':integer')
            .replace(/^int/g, 'integer')
            .replace(/:float/g, ':real')
            .replace(/^float/g, 'real')
            .replace(/struct/g, 'row')
            .replace(/</g, '(')
            .replace(/>/g, ')')
            .replace(/:/g, ' '),
        })),
        ...(model.partitions || []).map((column) => ({
          name: column.name,
          type: column.type
            .replace(/^string/g, 'varchar')
            .replace(/^int/g, 'integer'),
        })),
      ],
    }).replace(/\${(\w+)}/g, (match, key) => SQLTemplateVariables[key] || '');

    resourceOptions.push({
      name: model.name,
      properties: {
        description: model.description,
        tableType: 'VIRTUAL_VIEW',
        parameters: { comment: 'Presto View', presto_view: 'true' },
        columns: model.columns,
        partitionKeys: model.partitions,
        viewOriginalText: `/* Presto View: ${Buffer.from(templatedSQL).toString(
          'base64'
        )} */`,
        viewExpandedText: '/* Presto View */',
      },
    });
    modelsForValidation[model.name] = model.sql.replace(
      /\${(\w+)}/g,
      (match, key) => SQLTemplateVariables[key] || ''
    );
  }
  for (const source of project.sources) {
    const tableInput = getTableInput({
      TableName: source.name,
      Description: source.description,
      Location: '',
      Columns: [],
      PartitionKeys: [],
      Format: source.format === 'custom' ? undefined : source.format,
      CustomFormat: source.custom_format
        ? {
            Location: '',
            Columns: [],
            InputFormat: source.custom_format.input_format,
            OutputFormat: source.custom_format.output_format,
            SerdeInfo: {
              SerializationLibrary:
                source.custom_format.serde_info.serialization_library,
              Parameters: source.custom_format.serde_info.parameters,
            },
            Compressed: source.custom_format.compressed,
            StoredAsSubDirectories:
              source.custom_format.stored_as_sub_directories,
            NumberOfBuckets: source.custom_format.number_of_buckets,
          }
        : undefined,
    });
    resourceOptions.push({
      name: source.name,
      properties: {
        description: source.description,
        columns: source.columns,
        partitionKeys: source.partitions,
        inputLocation: source.input_location.path,
        tableType: 'EXTERNAL_TABLE',
        parameters: tableInput.Parameters,
        inputFormat: tableInput.StorageDescriptor.InputFormat,
        outputFormat: tableInput.StorageDescriptor.OutputFormat,
        numberOfBuckets: tableInput.StorageDescriptor.NumberOfBuckets,
        storedAsSubDirectories:
          tableInput.StorageDescriptor.StoredAsSubDirectories,
        serdeInfo: tableInput.StorageDescriptor.SerdeInfo,
        compressed: tableInput.StorageDescriptor.Compressed,
      },
    });
  }

  const errors = validateModelSql(modelsForValidation, project, environment);
  if (errors.length > 0) {
    throw new WharfieModelSQLError(
      `${errors.map((error) => error.message).join('\n\n')}`
    );
  }
  return resourceOptions;
}

module.exports = {
  getResourceOptions,
};
