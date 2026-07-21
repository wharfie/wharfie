/**
 * Cross-layer constants for the provider-visible service-health protocol.
 * Keep storage addressing, retention, and document bounds independent from
 * the receipt, provider, and transport implementations that consume them.
 */

export const DEPLOYMENT_SERVICE_HEALTH_OBJECT_PREFIX = 'health/v1/';
export const DEPLOYMENT_SERVICE_HEALTH_NONCURRENT_EXPIRATION_DAYS = 1;
export const DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES = 32 * 1024;

export default {
  DEPLOYMENT_SERVICE_HEALTH_DOCUMENT_MAX_BYTES,
  DEPLOYMENT_SERVICE_HEALTH_NONCURRENT_EXPIRATION_DAYS,
  DEPLOYMENT_SERVICE_HEALTH_OBJECT_PREFIX,
};
