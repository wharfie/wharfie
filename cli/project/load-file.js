const fs = require('fs/promises');
const path = require('path');
const yaml = require('js-yaml');

/**
 *
 * @param {import('fs').Dirent} dirent -
 * @returns {Promise<any>} -
 */
async function loadFile(dirent) {
  const fileExtension = dirent.name.split('.').at(-1);
  switch (fileExtension) {
    case 'json':
      return JSON.parse(
        await fs.readFile(path.join(dirent.parentPath, dirent.name), 'utf8')
      );
    case 'yaml':
    case 'yml':
      return yaml.load(
        await fs.readFile(path.join(dirent.parentPath, dirent.name), 'utf8')
      );
    default:
      return await fs.readFile(
        path.join(dirent.parentPath, dirent.name),
        'utf8'
      );
  }
}

module.exports = loadFile;
