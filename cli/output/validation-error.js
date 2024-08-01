const joi = require('joi');

/**
 *
 * @param {import('joi').ValidationError} error -
 */
function displayValidationError(error) {
  if (!(error instanceof joi.ValidationError)) {
    throw new Error('invalid erorr type');
  }
  console.log(error.details.map((detail) => detail.message).join('\n\n'));
}

module.exports = displayValidationError;
