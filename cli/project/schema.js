const joi = require('joi');

const projectSchema = joi.object({
  name: joi.string().required(),
  path: joi.string().required(),
  environments: joi
    .array()
    .items(
      joi.object({
        name: joi.string().required(),
        variables: joi
          .object()
          .pattern(
            joi.string(),
            joi
              .alternatives()
              .try(joi.string(), joi.object({ ref: joi.string() }))
          ),
      })
    )
    .unique((a, b) => a.name === b.name),
  models: joi
    .array()
    .items(
      joi.object({
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
      })
    )
    .unique((a, b) => a.name === b.name),
  sources: joi
    .array()
    .items(
      joi.object({
        name: joi.string().required(),
        description: joi.string().required(),
        format: joi
          .string()
          .valid('csv', 'json', 'orc', 'parquet', 'cloudtrail', 'cloudfront'),
        custom_format: joi.alternatives().conditional('format', {
          is: joi.any().empty(),
          then: joi
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
    )
    .unique((a, b) => a.name === b.name),
});

/**
 *
 * @param {import('./typedefs').Project} project -
 * @returns {import('./typedefs').Project} -
 */
function validateProject(project) {
  const { error, value } = projectSchema.validate(project);
  // TODO make these error coherant to users
  if (error) throw error;
  return value;
}

module.exports = {
  projectSchema,
  validateProject,
};
