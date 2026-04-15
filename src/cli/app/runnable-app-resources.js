import { resolveSharedResourceSpecs } from '../../core/runtime/shared-resource-registry.js';

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, any>} - Result.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {Record<string, any>} container - container.
 * @param {string} key - key.
 * @returns {Promise<void>} - Result.
 */
async function resolveContainerResourceField(container, key) {
  if (!Object.prototype.hasOwnProperty.call(container, key)) {
    return;
  }

  const current = container[key];
  if (!isObjectRecord(current)) {
    return;
  }

  container[key] = await resolveSharedResourceSpecs(current);
}

/**
 * @param {Record<string, any>} container - container.
 * @returns {Promise<void>} - Result.
 */
async function resolvePlainAppResourceFields(container) {
  await resolveContainerResourceField(container, 'resources');
  await resolveContainerResourceField(container, 'capabilities');

  if (isObjectRecord(container.properties)) {
    await resolveContainerResourceField(container.properties, 'resources');
    await resolveContainerResourceField(container.properties, 'capabilities');
  }
}

/**
 * @param {any} fn - fn.
 * @returns {Promise<void>} - Result.
 */
async function resolveFunctionResourceFields(fn) {
  if (!isObjectRecord(fn) || !isObjectRecord(fn.properties)) {
    return;
  }

  await resolveContainerResourceField(fn.properties, 'resources');
}

/**
 * @param {any} appExport - appExport.
 * @returns {Promise<void>} - Result.
 */
export async function resolveRunnableAppResourceRefs(appExport) {
  if (!isObjectRecord(appExport)) {
    return;
  }

  if (
    typeof appExport.get === 'function' &&
    typeof appExport._setUNSAFE === 'function'
  ) {
    const currentResources = appExport.get(
      'resources',
      appExport.properties?.resources ?? {},
    );
    if (isObjectRecord(currentResources)) {
      const resolvedResources =
        await resolveSharedResourceSpecs(currentResources);
      appExport._setUNSAFE('resources', resolvedResources);
      if (isObjectRecord(appExport.properties)) {
        appExport.properties.resources = resolvedResources;
      }
    }
  } else {
    await resolvePlainAppResourceFields(appExport);
    if (isObjectRecord(appExport.app)) {
      await resolvePlainAppResourceFields(appExport.app);
    }
  }

  const functions = Array.isArray(appExport.functions)
    ? appExport.functions
    : [];
  await Promise.all(functions.map((fn) => resolveFunctionResourceFields(fn)));
}

export default {
  resolveRunnableAppResourceRefs,
};
