'use strict';

const intrinsic = require('./intrinsic');
const pseudo = require('./pseudo');
const merge = require('./merge');
const conditions = require('./conditions');

const utils = (module.exports = {
  merge,
});

Object.keys(intrinsic).forEach((key) => {
  utils[key] = intrinsic[key];
});

Object.keys(pseudo).forEach((key) => {
  utils[key] = pseudo[key];
});

Object.keys(conditions).forEach((key) => {
  utils[key] = conditions[key];
});
