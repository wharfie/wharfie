const joi = require('joi');
const { WharfieModelSQLError } = require('../project/model-validator');

/**
 *
 * @param {Error} error -
 * @returns {boolean} -
 */
function isValidationError(error) {
  if (error instanceof joi.ValidationError) {
    return true;
  } else if (error instanceof WharfieModelSQLError) {
    return true;
  }
  return false;
}

/**
 *
 * @param {import('joi').ValidationError} error -
 */
function displayValidationError(error) {
  if (!isValidationError(error)) {
    throw new Error('invalid erorr type');
  }
  if (error instanceof joi.ValidationError) {
    console.log(error.details.map((detail) => detail.message).join('\n\n'));
  } else {
    console.log(error.message);
  }
}

module.exports = { displayValidationError, isValidationError };
