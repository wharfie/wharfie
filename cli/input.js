'use strict';

const { displayFailure } = require('./output');
const fs = require('fs');

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

exports.isFilePath = (inputString) => {
  try {
    return fs.lstatSync(inputString).isFile();
  } catch (err) {
    return false;
  }
};

exports.readFile = (path) => {
  try {
    return fs.readFileSync(path).toString();
  } catch (err) {
    displayFailure(err);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
};
