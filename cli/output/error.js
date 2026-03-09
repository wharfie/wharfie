import joi from 'joi';

import { WharfieModelSQLError } from '../project/model-validator.js';
import { displayFailure } from './basic.js';

/**
 *
 * @param {Error | unknown} error -
 * @returns {boolean} -
 */
export function isValidationError(error) {
  if (error instanceof joi.ValidationError) {
    return true;
  } else if (error instanceof WharfieModelSQLError) {
    return true;
  } else {
    return false;
  }
}

/**
 *
 * @param {import('joi').ValidationError | WharfieModelSQLError} error -
 */
export function displayValidationError(error) {
  if (!isValidationError(error)) {
    throw new Error('invalid error type');
  }
  if (error instanceof joi.ValidationError) {
    console.log(error.details.map((detail) => detail.message).join('\n\n'));
  } else {
    console.log(error.message);
  }
}

/**
 *
 * @param {unknown} error -
 */
export function handleError(error) {
  if (
    error instanceof joi.ValidationError ||
    error instanceof WharfieModelSQLError
  ) {
    displayValidationError(error);
  } else {
    if (error instanceof Error) displayFailure(error.stack);
    else displayFailure(error);
  }
}
