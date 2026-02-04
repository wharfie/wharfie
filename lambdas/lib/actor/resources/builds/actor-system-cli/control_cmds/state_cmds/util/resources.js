import fs from 'node:fs';

/**
 * Load an ActorSystem-style resources spec object.
 *
 * Supports:
 * - --resources-file <path> (JSON)
 * - --resources <json>
 * - env WHARFIE_RESOURCES (JSON)
 * @param {{ resourcesFile?: string, resources_file?: string, resources?: string }} opts - opts.
 * @returns {any} - Result.
 */
export function loadResourcesSpec(opts = {}) {
  const resourcesFile = opts.resourcesFile || opts.resources_file;
  const resourcesJson = opts.resources;

  if (resourcesFile) {
    const raw = fs.readFileSync(resourcesFile, 'utf8');
    return JSON.parse(raw);
  }

  if (resourcesJson) {
    return JSON.parse(resourcesJson);
  }

  if (process.env.WHARFIE_RESOURCES) {
    return JSON.parse(process.env.WHARFIE_RESOURCES);
  }

  return {};
}
