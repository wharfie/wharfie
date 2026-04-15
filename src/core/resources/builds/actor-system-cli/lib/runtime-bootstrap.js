import fs from 'node:fs';
import { resolveSharedResourceSpecs } from '../../../../runtime/shared-resource-registry.js';
import {
  getManifestFunctions,
  getManifestPollQueueUrls,
  getManifestResources,
  resolveAppManifest,
} from './app-manifest.js';

/**
 * @param {any} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {{ resourcesFile?: string, resources_file?: string, resources?: string }} opts - opts.
 * @returns {boolean} - Result.
 */
function hasExplicitResources(opts) {
  return Boolean(
    opts.resourcesFile ||
    opts.resources_file ||
    opts.resources ||
    process.env.WHARFIE_RESOURCES,
  );
}

/**
 * @param {string} raw - raw.
 * @param {string} label - label.
 * @returns {any} - Result.
 */
function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    const message =
      error && typeof error === 'object' && 'message' in error
        ? String(error.message)
        : String(error);
    throw new Error(`Failed to parse ${label}: ${message}`);
  }
}

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
    return parseJson(
      fs.readFileSync(resourcesFile, 'utf8'),
      `resources file '${resourcesFile}'`,
    );
  }

  if (resourcesJson) {
    return parseJson(resourcesJson, '--resources JSON');
  }

  if (process.env.WHARFIE_RESOURCES) {
    return parseJson(process.env.WHARFIE_RESOURCES, 'WHARFIE_RESOURCES');
  }

  return {};
}

/**
 * @param {unknown} value - value.
 * @returns {string[]} - Result.
 */
function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.reduce((acc, candidate) => {
    if (typeof candidate === 'string' && candidate.trim()) {
      acc.push(candidate.trim());
    }
    return acc;
  }, /** @type {string[]} */ ([]));
}

/**
 * Extract cron triggers from a manifest/config-like object.
 *
 * Supported shapes (MVP):
 * - { scheduler: { triggers: [{ actor, cron }] } }
 * - { cronTriggers: [{ actor, cron }] }
 * - { cron: [{ actor, cron }] }
 * @param {any} spec - spec.
 * @returns {{ actor: string, cron: string }[]} - Result.
 */
export function extractCronTriggers(spec) {
  if (!spec || typeof spec !== 'object') return [];

  const candidates = [
    spec?.scheduler?.triggers,
    spec?.scheduler?.cronTriggers,
    spec?.cronTriggers,
    spec?.cron,
  ];

  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;

    /** @type {{ actor: string, cron: string }[]} */
    const triggers = [];
    for (const trigger of candidate) {
      if (!isObjectRecord(trigger)) continue;
      const actor =
        typeof trigger.actor === 'string'
          ? trigger.actor
          : typeof trigger.functionName === 'string'
            ? trigger.functionName
            : null;
      const cron = typeof trigger.cron === 'string' ? trigger.cron : null;
      if (!actor || !cron) continue;
      triggers.push({ actor: actor.trim(), cron: cron.trim() });
    }

    if (triggers.length > 0) {
      return triggers;
    }
  }

  return [];
}

/**
 * @typedef RuntimeBootstrap
 * @property {any | undefined} manifest - manifest.
 * @property {Record<string, any>} resourcesSpec - resourcesSpec.
 * @property {string[]} pollQueueUrls - pollQueueUrls.
 * @property {{ actor: string, cron: string }[]} schedulerTriggers - schedulerTriggers.
 * @property {{ db: boolean, queue: boolean, objectStorage: boolean, lambda: boolean, scheduler: boolean }} servicePlan - servicePlan.
 */

/**
 * @param {{ resourcesFile?: string, resources_file?: string, resources?: string, manifestFile?: string, manifest_file?: string, manifest?: string, pollQueueUrl?: string[] }} [opts] - opts.
 * @param {{ assetProvider?: import('../../lib/app-manifest-asset.js').EmbeddedManifestAssetProvider }} [options] - options.
 * @returns {Promise<RuntimeBootstrap>} - Result.
 */
export async function loadRuntimeBootstrap(opts = {}, options = {}) {
  const manifest = await resolveAppManifest(opts, options);
  const explicitResources = hasExplicitResources(opts)
    ? loadResourcesSpec(opts)
    : undefined;
  const manifestResources = getManifestResources(manifest);
  const unresolvedResourcesSpec = isObjectRecord(explicitResources)
    ? explicitResources
    : isObjectRecord(manifestResources)
      ? manifestResources
      : {};
  const resourcesSpec = isObjectRecord(unresolvedResourcesSpec)
    ? await resolveSharedResourceSpecs(unresolvedResourcesSpec)
    : {};

  const explicitPollQueueUrls = normalizeStringArray(opts.pollQueueUrl);
  const pollQueueManifest = manifest
    ? {
        ...manifest,
        capabilities: resourcesSpec,
        resources: resourcesSpec,
      }
    : resourcesSpec;
  const pollQueueUrls =
    explicitPollQueueUrls.length > 0
      ? explicitPollQueueUrls
      : getManifestPollQueueUrls(pollQueueManifest);
  const schedulerTriggers = extractCronTriggers(manifest || resourcesSpec);
  const functions = getManifestFunctions(manifest);

  return {
    manifest,
    resourcesSpec,
    pollQueueUrls,
    schedulerTriggers,
    servicePlan: {
      db: resourcesSpec.db !== undefined,
      queue: resourcesSpec.queue !== undefined,
      objectStorage: resourcesSpec.objectStorage !== undefined,
      lambda: manifest ? functions.length > 0 : true,
      scheduler: schedulerTriggers.length > 0,
    },
  };
}

export default {
  extractCronTriggers,
  loadResourcesSpec,
  loadRuntimeBootstrap,
};
