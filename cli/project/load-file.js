import fs from 'node:fs/promises';
import path from 'node:path';

import yaml from 'js-yaml';

/**
 *
 * @param {import('fs').Dirent} dirent -
 * @returns {Promise<any>} -
 */
export default async function loadFile(dirent) {
  const fileParts = dirent.name.split('.');
  const fileExtension = fileParts[fileParts.length - 1];
  switch (fileExtension) {
    case 'json':
      return JSON.parse(
        await fs.readFile(path.join(dirent.parentPath, dirent.name), 'utf8'),
      );
    case 'yaml':
    case 'yml':
      return yaml.load(
        await fs.readFile(path.join(dirent.parentPath, dirent.name), 'utf8'),
      );
    default:
      return await fs.readFile(
        path.join(dirent.parentPath, dirent.name),
        'utf8',
      );
  }
}
