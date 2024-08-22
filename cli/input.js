'use strict';

const { displayFailure } = require('./output/basic');
const fs = require('fs');

// eslint-disable-next-line jsdoc/require-returns-check
/**
 * @param {string} jsonString -
 * @param {string} errorMessage -
 * @returns {object} -
 */
exports.parseJSON = (jsonString, errorMessage) => {
  try {
    return JSON.parse(jsonString);
  } catch (err) {
    displayFailure(err);
    displayFailure(errorMessage);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
};
/**
 * @param {string} inputString -
 * @returns {boolean} -
 */
exports.isFilePath = (inputString) => {
  try {
    return fs.lstatSync(inputString).isFile();
  } catch (err) {
    return false;
  }
};

// eslint-disable-next-line jsdoc/require-returns-check
/**
 * @param {string} path -
 * @returns {string} -
 */
exports.readFile = (path) => {
  try {
    return fs.readFileSync(path).toString();
  } catch (err) {
    displayFailure(err);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
};
