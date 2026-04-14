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
 * @param {Record<string, any> | undefined} operation - operation.
 * @returns {Record<string, any>} - Result.
 */
function getOperationConfig(operation) {
  return operation?.operation_config &&
    typeof operation.operation_config === 'object'
    ? operation.operation_config
    : {};
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
    .map((operation) => {
      const config = getOperationConfig(operation);
      return {
        id: operation.id,
        app:
          typeof config.app === 'string' && config.app.trim() ? config.app : '',
        activity:
          typeof config.activity === 'string' && config.activity.trim()
            ? config.activity
            : '',
        workflow:
          typeof config.workflow === 'string' && config.workflow.trim()
            ? config.workflow
            : typeof config.workflow_name === 'string' &&
                config.workflow_name.trim()
              ? config.workflow_name
              : '',
        type: operation.type,
        status: operation.status,
        trigger:
          typeof config.trigger?.source === 'string' &&
          config.trigger.source.trim()
            ? config.trigger.source
            : '',
        started_at: toIsoTimestamp(operation.started_at),
        last_updated_at: toIsoTimestamp(operation.last_updated_at),
      };
    });
}
