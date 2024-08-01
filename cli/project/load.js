'use strict';

const fs = require('fs/promises');
const path = require('path');

const loadFile = require('./load-file');
const { WHARFIE_DEFAULT_ENVIRONMENT } = require('./constants');
const { validateProject } = require('./schema');

/**
 * @typedef LoadProjectOptions
 * @property {string} path -
 */

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {import('./typedefs').Model[]} -
 */
async function loadModels(options) {
  /** @type {Object<string,import('./typedefs').Model>} */
  const models = {};
  const files = await fs.readdir(path.join(options.path, 'models'), {
    withFileTypes: true,
    recursive: true,
  });
  for (const file of files) {
    if (!file.isFile()) {
      continue;
    }
    const fileExtension = file.name.split('.').at(-1);
    const fileData = await loadFile(file);
    const modelName = file.name.split('.').at(0);
    if (!models[modelName]) {
      models[modelName] = {};
    }
    if (fileExtension === 'sql') {
      models[modelName].sql = fileData;
    } else {
      models[modelName] = { ...models[modelName], ...fileData };
    }
  }
  return Object.values(models);
}

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {import('./typedefs').Source[]} -
 */
async function loadSources(options) {
  const sources = [];
  const files = await fs.readdir(path.join(options.path, 'sources'), {
    withFileTypes: true,
    recursive: true,
  });
  for (const file of files) {
    const fileData = await loadFile(file);
    sources.push(fileData);
  }
  return sources;
}

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {Object<string,import('./typedefs').Environment>} -
 */
async function loadEnvironments(options) {
  const environments = [];

  const files = await fs.readdir(options.path, {
    withFileTypes: true,
  });

  for (const file of files) {
    if (!file.isFile()) {
      continue;
    }
    const [prefix, environmentName, suffix] = file.name.split('.');
    if (prefix === 'wharfie' && ['json', 'yaml', 'yml'].includes(suffix)) {
      const fileData = await loadFile(file);
      environments.push({
        ...fileData,
        name: environmentName,
      });
    }
    if (
      prefix === 'wharfie' &&
      ['json', 'yaml', 'yml'].includes(environmentName)
    ) {
      const fileData = await loadFile(file);
      environments.push({
        ...fileData,
        name: WHARFIE_DEFAULT_ENVIRONMENT,
      });
    }
  }
  return environments;
}

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {Promise<import('./typedefs').Project>} -
 */
async function loadProject(options) {
  const project = {
    name: options.path.split('/').at(-1).replace(/=+$/, '').toLowerCase(),
    path: options.path,
    environments: await loadEnvironments(options),
    models: await loadModels(options),
    sources: await loadSources(options),
  };

  const validatedProject = validateProject(project);
  return validatedProject;
}

module.exports = { loadProject };
