/**
 * Normalize nested AWS SDK payloads so semantically equivalent configs compare
 * equal regardless of key order, empty containers, or array order.
 * @param {any} value - value.
 * @returns {any} - Result.
 */
function normalize(value) {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => normalize(item))
      .filter((item) => item !== undefined);
    if (items.length === 0) return undefined;
    return items.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
      .map(([key, item]) => [key, normalize(item)])
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    if (entries.length === 0) return undefined;
    return Object.fromEntries(entries);
  }

  if (value === undefined) return undefined;
  return value;
}

/**
 * @param {any} left - left.
 * @param {any} right - right.
 * @returns {boolean} - Result.
 */
export function configsEqual(left, right) {
  return (
    JSON.stringify(normalize(left) || null) ===
    JSON.stringify(normalize(right) || null)
  );
}
