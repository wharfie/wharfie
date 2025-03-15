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
 * Asynchronously reads the contents of a directory.
 * @param {string} path - The path to the directory to read.
 * @param {boolean} [recursive] - Optional. Whether to read the directory recursively. Defaults to true.
 * @returns {Promise<import('fs').Dirent[]>} A promise that resolves to an array of filenames or Buffer objects.
 */
async function readDirectory(path, recursive = true) {
  try {
    // check if directory exists if not do not error
    await fs.access(path);
  } catch {
    return [];
  }
  return fs.readdir(path, {
    withFileTypes: true,
    recursive,
  });
}

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {Promise<import('./typedefs').Model[]>} -
 */
async function loadModels(options) {
  /** @type {Object<string,import('./typedefs').Model | Object<string, any>>} */
  const models = {};
  const files = await readDirectory(path.join(options.path, 'models'));
  for (const file of files) {
    if (!file.isFile()) {
      continue;
    }
    const fileExtension = file.name.split('.').at(-1);
    const fileData = await loadFile(file);
    const modelName = file.name.split('.').at(0);
    if (!modelName) throw new Error('Invalid model name');
    if (!models[modelName]) {
      models[modelName] = {};
    }
    if (fileExtension === 'sql') {
      models[modelName].sql = fileData;
    } else if (['json', 'yaml', 'yml'].includes(fileExtension || '')) {
      models[modelName] = { ...models[modelName], ...fileData };
    } else {
      continue;
    }
  }
  // @ts-ignore
  return Object.values(models);
}

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {Promise<import('./typedefs').Source[]>} -
 */
async function loadSources(options) {
  const sources = [];
  const files = await readDirectory(path.join(options.path, 'sources'));
  for (const file of files) {
    const fileExtension = file.name.split('.').at(-1);
    if (['json', 'yaml', 'yml'].includes(fileExtension || '')) {
      const fileData = await loadFile(file);
      sources.push(fileData);
    }
  }
  return sources;
}

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {Promise<import('./typedefs').Environment[]>} -
 */
async function loadEnvironments(options) {
  const environments = [];

  const files = await readDirectory(options.path, false);

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
 *  @returns {Promise<import('./typedefs').Definition[]>} -
 */
async function loadDefinitions(options) {
  const definitions = [];
  const files = await readDirectory(path.join(options.path, 'definitions'));
  for (const file of files) {
    const fileExtension = file.name.split('.').at(-1);
    if (['json', 'yaml', 'yml'].includes(fileExtension || '')) {
      const fileData = await loadFile(file);
      // to avoid adding other code related config files to definitions (package.json, etc)
      if (!fileData.definition_type) continue;
      definitions.push(fileData);
    }
  }
  return definitions;
}

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {Promise<import('./typedefs').Sink[]>} -
 */
async function loadSinks(options) {
  const sinks = [];
  const files = await readDirectory(path.join(options.path, 'sinks'));
  for (const file of files) {
    const fileExtension = file.name.split('.').at(-1);
    if (['json', 'yaml', 'yml'].includes(fileExtension || '')) {
      const fileData = await loadFile(file);
      sinks.push(fileData);
    }
  }
  return sinks;
}

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {Promise<import('./typedefs').Tap[]>} -
 */
async function loadTaps(options) {
  const taps = [];
  const files = await readDirectory(path.join(options.path, 'taps'));
  for (const file of files) {
    const fileExtension = file.name.split('.').at(-1);
    if (['json', 'yaml', 'yml'].includes(fileExtension || '')) {
      const fileData = await loadFile(file);
      taps.push(fileData);
    }
  }
  return taps;
}

/**
 *  @param {LoadProjectOptions} options -
 *  @returns {Promise<import('./typedefs').Project>} -
 */
async function loadProject(options) {
  const project_folder_name = options.path.split('/').at(-1);
  if (!project_folder_name) throw new Error('Invalid project path');
  const project = {
    name: project_folder_name.replace(/=+$/, '').toLowerCase(),
    path: options.path,
    environments: await loadEnvironments(options),
    models: await loadModels(options),
    sources: await loadSources(options),
    definitions: await loadDefinitions(options),
    sinks: await loadSinks(options),
    taps: await loadTaps(options),
  };

  const validatedProject = validateProject(project);
  return validatedProject;
}

module.exports = { loadProject };
