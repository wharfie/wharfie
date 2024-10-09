const joi = require('joi');
const chalk = require('chalk');

const environmentSchema = joi.object({
  name: joi.string().required(),
  variables: joi
    .object()
    .pattern(
      joi.string(),
      joi.alternatives().try(joi.string(), joi.object({ ref: joi.string() }))
    ),
});

const modelSchema = joi.object({
  name: joi.string().required(),
  description: joi.string().required(),
  sql: joi.string().required(),
  columns: joi.array().items(
    joi.object({
      name: joi.string().required(),
      type: joi.string().required(),
    })
  ),
  partitions: joi.array().items(
    joi.object({
      name: joi.string().required(),
      type: joi.string().required(),
    })
  ),
  service_level_agreement: joi.object({
    freshness: joi.number().required().min(5).max(10080),
  }),
});

const sourceSchema = joi
  .object({
    name: joi.string().required(),
    description: joi.string().required(),
    format: joi
      .string()
      .valid('csv', 'json', 'orc', 'parquet', 'cloudtrail', 'cloudfront')
      .when('custom_format', {
        is: joi.any().exist(),
        then: joi.forbidden(),
      }),
    custom_format: joi.alternatives().conditional('format', {
      is: joi.any().exist(),
      then: joi.forbidden(),
      otherwise: joi
        .object({
          input_format: joi.string().required(),
          output_format: joi.string().required(),
          serde_info: joi.object({
            serialization_library: joi.string().required(),
            parameters: joi.object().pattern(joi.string(), joi.string()),
          }),
          compressed: joi.boolean().default(true),
          stored_as_sub_directories: joi.boolean().default(true),
          number_of_buckets: joi.number().min(0).default(0),
        })
        .required(),
    }),
    input_location: joi.object({
      storage: joi.string().required(),
      path: joi
        .string()
        .required()
        .pattern(/^s3:\/\/([A-Za-z0-9-_./])+\/$/),
    }),
    columns: joi.array().items(
      joi.object({
        name: joi.string().required(),
        type: joi.string().required(),
      })
    ),
    partitions: joi.array().items(
      joi.object({
        name: joi.string().required(),
        type: joi.string().required(),
      })
    ),
    service_level_agreement: joi.object({
      freshness: joi.number().required().min(5).max(10080),
    }),
  })
  .xor('format', 'custom_format');

const projectSchema = joi.object({
  name: joi.string().required(),
  path: joi.string().required(),
  environments: joi
    .array()
    .items(environmentSchema)
    .unique((a, b) => a.name === b.name),
  models: joi
    .array()
    .items(modelSchema)
    .unique((a, b) => a.name === b.name),
  sources: joi
    .array()
    .items(sourceSchema)
    .unique((a, b) => a.name === b.name),
});

/**
 *
 * @param {(string | number)[]} path -
 * @returns {string} -
 */
function getResourceType(path) {
  switch (path[0]) {
    case 'models':
      return 'Model';
    case 'sources':
      return 'Source';
    case 'environments':
      return 'Environment';
    default:
      return 'Project';
  }
}

/**
 * @param {import('./typedefs').Project} project -
 * @param {(string | number)[]} path -
 * @returns {string} -
 */
function getResourceName(project, path) {
  if (path.length < 3) {
    return project.name;
  }
  // @ts-ignore
  return project[path[0]][path[1]].name;
}
/**
 * @param {(string | number)[]} path -
 * @returns {(string | number)[]} -
 */
function getErrorField(path) {
  if (path.length < 3) {
    return path;
  }
  return path.slice(2);
}

/**
 *
 * @param {import('./typedefs').Project} project -
 * @returns {import('./typedefs').Project} -
 */
function validateProject(project) {
  const { error, value } = projectSchema.validate(project, {
    abortEarly: false,
    errors: {
      label: false,
    },
  });
  if (error) {
    error.details = error.details.map((detail) => {
      const resourceType = getResourceType(detail.path);
      const resourceName = getResourceName(project, detail.path);
      const errorField = getErrorField(detail.path).reduce((acc, value) => {
        if (typeof value === 'number') {
          return `${acc}[${value}]`;
        }
        return `${acc}.${value}`;
      }, '');
      return {
        ...detail,
        message: `${chalk.bgWhite.black(
          `${resourceType}::${resourceName}`
        )} field(${chalk.bold(errorField)}) ${chalk.bold(detail.message)}`,
      };
    });
    throw error;
  }
  return value;
}

module.exports = {
  projectSchema,
  validateProject,
};
