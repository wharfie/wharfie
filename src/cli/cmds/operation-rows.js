/**
 * @param {number | string | undefined} value - value.
 * @returns {string} - Result.
 */
export function toIsoTimestamp(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return '';
  const epochMs = numeric < 1e12 ? numeric * 1000 : numeric;
  return new Date(epochMs).toISOString();
}

/**
 * @param {Array<Record<string, any>>} operations - operations.
 * @returns {Array<Record<string, string>>} - Result.
 */
export function formatOperationRows(operations = []) {
  return [...operations]
    .sort(
      (left, right) =>
        (Number(right.started_at) || 0) - (Number(left.started_at) || 0),
    )
    .map((operation) => ({
      id: operation.id,
      app:
        typeof operation.operation_config?.app_id === 'string'
          ? operation.operation_config.app_id
          : '',
      activity:
        typeof operation.operation_config?.activity_name === 'string'
          ? operation.operation_config.activity_name
          : '',
      trigger:
        typeof operation.operation_config?.trigger?.source === 'string'
          ? operation.operation_config.trigger.source
          : '',
      type: operation.type,
      status: operation.status,
      started_at: toIsoTimestamp(operation.started_at),
      last_updated_at: toIsoTimestamp(operation.last_updated_at),
    }));
}
