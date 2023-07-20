'use strict';

const Joi = require('joi');

const schema = Joi.object({
  ServiceToken: Joi.string().required(),
  Tags: Joi.array()
    .items(
      Joi.object({
        Key: Joi.string().required(),
        Value: Joi.string().required(),
      })
    )
    .unique('Key'),
  Handler: Joi.string().required(),
  Code: Joi.object({
    S3Bucket: Joi.string().required(),
    S3Key: Joi.string().required(),
    S3ObjectVersion: Joi.string(),
  }).required(),
});

/**
 * @param {import('../../../typedefs').CloudformationEvent} event -
 * @returns {import('../../../typedefs').CloudformationEvent} -
 */
function create(event) {
  const { error, value } = schema.validate(event.ResourceProperties);
  if (error) throw error;

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

  // POLICY VALIDATION GOES HERE

  event.ResourceProperties = value;
  return event;
}

module.exports = {
  create,
  update,
};
