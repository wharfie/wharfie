'use strict';

const Joi = require('joi');

const schema = Joi.object({
  Tags: Joi.array()
    .items(
      Joi.object({
        Key: Joi.string().required(),
        Value: Joi.string().required(),
      })
    )
    .unique('Key'),
  ServiceToken: Joi.string().required(),
  DatabaseName: Joi.string().required(),
  CatalogId: Joi.string().required(),
  CompactedConfig: Joi.object({
    Location: Joi.string()
      .required()
      .pattern(/^s3:\/\/([A-Za-z0-9-_./])+\/$/),
    Compression: Joi.string().valid('SNAPPY', 'ZLIB').default('ZLIB'),
    Format: Joi.string().valid('ORC').default('ORC'),
  }).required(),
  Backfill: Joi.object({
    Version: Joi.number().min(1).required(),
    Duration: Joi.number().min(0).required(),
  }),
  DaemonConfig: Joi.object({
    Privileged: Joi.bool(),
    Mode: Joi.string().valid('APPEND', 'REPLACE').default('REPLACE'),
    Role: Joi.string().required(),
    PrimaryKey: Joi.string(),
    Schedule: Joi.number(),
    Interval: Joi.number(),
    SLA: Joi.object({
      MaxDelay: Joi.number(),
      ColumnExpression: Joi.string(),
    }),
    AlarmActions: Joi.array().items(Joi.string()).unique(),
  }).required(),
  TableInput: Joi.object({
    Name: Joi.string().required(),
    Description: Joi.string(),
    TableType: Joi.string().required().valid('EXTERNAL_TABLE', 'VIRTUAL_VIEW'),
    ViewOriginalText: Joi.string(),
    ViewExpandedText: Joi.string(),
    Owner: Joi.string(),
    Parameters: Joi.object().unknown(),
    PartitionKeys: Joi.array()
      .items(
        Joi.object({
          Name: Joi.string().required(),
          Type: Joi.string().required(),
          Comment: Joi.string(),
        })
      )
      .required()
      .unique('Name'),
    Retention: Joi.number(),
    StorageDescriptor: Joi.object({
      BucketColumns: Joi.array().items(Joi.string()).unique(),
      Columns: Joi.array()
        .items(
          Joi.object({
            Name: Joi.string().required(),
            Type: Joi.string().required(),
            Comment: Joi.string(),
          })
        )
        .required()
        .unique('Name'),
      Location: Joi.string()
        .required()
        .pattern(/^s3:\/\/([A-Za-z0-9-_./])+\/$/)
        .allow(''),
      InputFormat: Joi.string(),
      OutputFormat: Joi.string(),
      SerdeInfo: Joi.object({
        Name: Joi.string(),
        Parameters: Joi.object().unknown(),
        SerializationLibrary: Joi.string(),
      }).required(),
      SortColumns: Joi.array().items(
        Joi.object({
          Column: Joi.string().required(),
          SortOrder: Joi.number(),
        })
      ),
      SkewedInfo: Joi.object({
        SkewedColumnNames: Joi.array().items(Joi.string()),
        SkewedColumnValueLocationMaps: Joi.object().unknown(),
        SkewedColumnValues: Joi.array().items(Joi.string()),
      }),
      NumberOfBuckets: Joi.number(),
      StoredAsSubDirectories: Joi.boolean(),
      Compressed: Joi.boolean(),
    }),
  }).required(),
});

const privilegedDaemonSchema = Joi.object({
  Schedule: Joi.number().min(5).max(10080),
}).unknown();

const regularDaemonSchema = Joi.object({
  Schedule: Joi.number().min(1440).max(10080),
}).unknown();

/**
 * @param {import('../../../typedefs').CloudformationEvent} event -
 * @returns {import('../../../typedefs').CloudformationEvent} -
 */
function create(event) {
  const { error, value } = schema.validate(event.ResourceProperties);
  if (error) throw error;

  const daemonConfigKeys = Object.keys(value.DaemonConfig);
  if (
    daemonConfigKeys.includes('Schedule') &&
    daemonConfigKeys.includes('Interval')
  ) {
    throw Error(
      'Cannot set both DaemonConfig.Schedule && DaemonConfig.Interval!'
    );
  }

  if (value.DaemonConfig.Privileged) {
    const { error } = privilegedDaemonSchema.validate(value.DaemonConfig);
    if (error) throw error;
  } else {
    const { error } = regularDaemonSchema.validate(value.DaemonConfig);
    if (error) throw error;
  }
  // POLICY VALIDATION GOES HERE

  event.ResourceProperties = value;
  return event;
}
/**
 * @param {import('../../../typedefs').CloudformationUpdateEvent} event -
 * @returns {import('../../../typedefs').CloudformationUpdateEvent} -
 */
function update(event) {
  const { error, value } = schema.validate(event.ResourceProperties);
  if (error) throw error;

  const daemonConfigKeys = Object.keys(value.DaemonConfig);
  if (
    daemonConfigKeys.includes('Schedule') &&
    daemonConfigKeys.includes('Interval')
  ) {
    throw Error(
      'Cannot set both DaemonConfig.Schedule && DaemonConfig.Interval!'
    );
  }

  if (value.DaemonConfig.Privileged) {
    const { error } = privilegedDaemonSchema.validate(value.DaemonConfig);
    if (error) throw error;
  } else {
    const { error } = regularDaemonSchema.validate(value.DaemonConfig);
    if (error) throw error;
  }

  // POLICY VALIDATION GOES HERE

  event.ResourceProperties = value;
  return event;
}

module.exports = {
  create,
  update,
};
