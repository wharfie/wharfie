const joi = require('joi');
const chalk = require('chalk');
const { dynamicSchema, generateConfigSchema } = require('./dynamic');

const secretRefSchema = joi
  .alternatives()
  .try(joi.string(), joi.object({ ref: joi.string() }));

const environmentSchema = joi.object({
  name: joi.string().required(),
  variables: joi.object().pattern(joi.string(), secretRefSchema),
});

const serviceLevelAgreementSchema = joi.object({
  freshness: joi.number().required().min(5).max(10080),
});

const definitionSchema = joi.object({
  name: joi.string().required(),
  description: joi.string().required(),
  definition_type: joi.string().valid('side_effect', 'tap', 'sink').required(),
  runtime: joi.object({
    language: joi.string().valid('node', 'python').required(),
    version: joi.any().required(),
    architecture: joi.string().valid('arm64', 'x86_64').required(),
  }),
  timeout: joi.number().required().min(3).max(900),
  memory: joi.number().required().min(128).max(10240),
  entrypoint: joi.string().required(),
  environment_variables: joi.object().pattern(joi.string(), secretRefSchema),
  configuration_definition: dynamicSchema,
});

const sinkSchema = joi.object({
  name: joi.string().required(),
  sink_type: joi.string().required(),
  input: joi
    .object({
      source_name: joi.string(),
      model_name: joi.string(),
    })
    .xor('source_name', 'model_name'),
  service_level_agreement: serviceLevelAgreementSchema,
  config: joi.object(),
});

const tapSchema = joi.object({
  name: joi.string().required(),
  tap_type: joi.string().required(),
  service_level_agreement: serviceLevelAgreementSchema,
  config: joi.object(),
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
  service_level_agreement: serviceLevelAgreementSchema,
  side_effects: joi.array().items(
    joi.object({
      type: joi.string().required(),
      trigger: joi.string().valid('onChange').required(),
      config: joi.object(),
    })
  ),
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
    service_level_agreement: serviceLevelAgreementSchema,
    side_effects: joi.array().items(
      joi.object({
        type: joi.string().required(),
        trigger: joi.string().valid('onChange').required(),
        config: joi.object(),
      })
    ),
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
  sinks: joi
    .array()
    .items(sinkSchema)
    .unique((a, b) => a.name === b.name),
  taps: joi
    .array()
    .items(tapSchema)
    .unique((a, b) => a.name === b.name),
  definitions: joi
    .array()
    .items(definitionSchema)
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
    case 'sinks':
      return 'Sink';
    case 'taps':
      return 'Tap';
    case 'definitions':
      return 'Definition';
    default:
      return 'Project';
  }
}

/**
 * @param {import('../typedefs').Project} project -
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
 * Validate dynamic configuration objects in sinks, taps, and side_effects.
 * This function builds a mapping of dynamic config schemas from the definitions
 * and uses them to validate the corresponding config field.
 * @param {import('../typedefs').Project} project -
 * @returns {import('../typedefs').Project} -
 */
function validateDynamicConfigs(project) {
  // Assemble mapping of dynamic schemas from definitions
  /** @type {Object<string, joi.Schema>} */
  const dynamicSchemasMapping = {};

  for (const def of project.definitions) {
    try {
      dynamicSchemasMapping[def.name] = generateConfigSchema(
        def.configuration_definition
      );
    } catch (err) {
      throw new Error(
        `Invalid dynamic schema definition for '${def.name}': ${
          err instanceof Error ? err.message : err
        }`
      );
    }
  }

  // Validate sinks
  for (const sink of project.sinks) {
    const schema = dynamicSchemasMapping[sink.sink_type];
    if (!schema) {
      throw new Error(`No definition exists for sink type '${sink.sink_type}'`);
    }
    const { error, value: validatedConfig } = schema.validate(sink.config, {
      abortEarly: false,
    });
    if (error) {
      error.details = error.details.map((detail) => ({
        ...detail,
        message: `Sink '${sink.name}' config error: ${detail.message}`,
      }));
      throw error;
    }
    sink.config = validatedConfig;
  }

  // Validate taps
  for (const tap of project.taps) {
    const schema = dynamicSchemasMapping[tap.tap_type];
    if (!schema) {
      throw new Error(`No definition exists for tap type '${tap.tap_type}'`);
    }
    const { error, value: validatedConfig } = schema.validate(tap.config, {
      abortEarly: false,
    });
    if (error) {
      error.details = error.details.map((detail) => ({
        ...detail,
        message: `Tap '${tap.name}' config error: ${detail.message}`,
      }));
      throw error;
    }
    tap.config = validatedConfig;
  }

  // Validate side_effects for models
  for (const model of project.models) {
    if (model.side_effects) {
      for (const sideEffect of model.side_effects) {
        const schema = dynamicSchemasMapping[sideEffect.type];
        if (!schema) {
          throw new Error(
            `side_effect type '${sideEffect.type}' used in model '${model.name}' does not exist in the project`
          );
        }
        const { error, value: validatedConfig } = schema.validate(
          sideEffect.config,
          { abortEarly: false }
        );
        if (error) {
          error.details = error.details.map((detail) => ({
            ...detail,
            message: `Model '${model.name}' side_effect config error: ${detail.message}`,
          }));
          throw error;
        }
        sideEffect.config = validatedConfig;
      }
    }
  }

  // Validate side_effects for sources
  for (const source of project.sources) {
    if (source.side_effects) {
      for (const sideEffect of source.side_effects) {
        const schema = dynamicSchemasMapping[sideEffect.type];
        if (!schema) {
          throw new Error(
            `side_effect type '${sideEffect.type}' used in model '${source.name}' does not exist in the project`
          );
        }
        const { error, value: validatedConfig } = schema.validate(
          sideEffect.config,
          { abortEarly: false }
        );
        if (error) {
          error.details = error.details.map((detail) => ({
            ...detail,
            message: `Source '${source.name}' side_effect config error: ${detail.message}`,
          }));
          throw error;
        }
        sideEffect.config = validatedConfig;
      }
    }
  }

  return project;
}

/**
 *
 * @param {import('../typedefs').Project} project -
 * @returns {import('../typedefs').Project} -
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

  return validateDynamicConfigs(value);
}

module.exports = {
  projectSchema,
  validateProject,
};
