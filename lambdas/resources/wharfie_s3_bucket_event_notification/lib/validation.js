'use strict';

const Joi = require('joi');

const schema = Joi.object({
  ServiceToken: Joi.string().required(),
  S3URI: Joi.string().required(),
});

/**
 * @param {import('../../../typedefs').CloudformationEvent} event -
 * @returns {import('../../../typedefs').CloudformationEvent} -
 */
function create(event) {
  const { error, value } = schema.validate(event.ResourceProperties);
  if (error) throw error;
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
