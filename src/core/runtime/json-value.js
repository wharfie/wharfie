/**
 * @param {string} label - Boundary label.
 * @param {(string | number)[]} path - Path segments.
 * @returns {string} - Human-readable JSON path.
 */
function formatPath(label, path) {
  const suffix = path.reduce((current, segment) => {
    if (typeof segment === 'number') {
      return `${current}[${segment}]`;
    }

    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
      ? `${current}.${segment}`
      : `${current}[${JSON.stringify(segment)}]`;
  }, '$');

  return `${label} at ${suffix}`;
}

/**
 * @param {object} prototype - Candidate built-in prototype.
 * @param {string} name - Expected constructor name.
 * @returns {boolean} - Whether the prototype owns the expected constructor.
 */
function hasOwnConstructorNamed(prototype, name) {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
  return (
    !!descriptor &&
    'value' in descriptor &&
    typeof descriptor.value === 'function' &&
    descriptor.value.name === name &&
    descriptor.value.prototype === prototype
  );
}

/**
 * Jest VMs and worker messages can produce ordinary objects whose built-in
 * prototype belongs to another realm. Identity checks against this realm's
 * Object.prototype would incorrectly reject those values.
 * @param {object | null} prototype - Candidate Object.prototype.
 * @returns {boolean} - Whether this is a realm's built-in Object.prototype.
 */
function isRealmObjectPrototype(prototype) {
  return (
    prototype !== null &&
    Object.getPrototypeOf(prototype) === null &&
    hasOwnConstructorNamed(prototype, 'Object')
  );
}

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, unknown>} - Whether the value is a plain object.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === null || isRealmObjectPrototype(prototype);
}

/**
 * @param {unknown} value - Candidate array.
 * @returns {value is unknown[]} - Whether the value is a non-subclassed array.
 */
function isPlainArray(value) {
  if (!Array.isArray(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  if (prototype === Array.prototype) return true;

  return (
    prototype !== null &&
    hasOwnConstructorNamed(prototype, 'Array') &&
    isRealmObjectPrototype(Object.getPrototypeOf(prototype))
  );
}

/**
 * @param {unknown} value - Candidate JSON value.
 * @param {string} label - Boundary label.
 * @param {(string | number)[]} path - Path segments.
 * @param {WeakSet<object>} ancestors - Objects on the active traversal path.
 * @returns {any} - Cloned JSON value.
 */
function cloneValue(value, label, path, ancestors) {
  if (value === null) return null;

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new TypeError(
          `${formatPath(label, path)} must be a finite JSON number.`,
        );
      }
      if (Object.is(value, -0)) {
        throw new TypeError(
          `${formatPath(label, path)} must not contain negative zero because JSON transport normalizes it to zero.`,
        );
      }
      return value;
    case 'undefined':
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new TypeError(
        `${formatPath(label, path)} contains an unsupported ${typeof value} value.`,
      );
    default:
      break;
  }

  const objectValue = /** @type {object} */ (value);
  if (ancestors.has(objectValue)) {
    throw new TypeError(`${formatPath(label, path)} contains a cycle.`);
  }
  ancestors.add(objectValue);

  try {
    if (Array.isArray(value)) {
      if (!isPlainArray(value)) {
        throw new TypeError(
          `${formatPath(label, path)} must be a plain JSON array.`,
        );
      }

      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new TypeError(
            `${formatPath(label, [...path, index])} is missing from a sparse array.`,
          );
        }
      }

      const allowedKeys = new Set([
        'length',
        ...Array.from({ length: value.length }, (_, index) => String(index)),
      ]);
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key !== 'string' || !allowedKeys.has(key)) {
          throw new TypeError(
            `${formatPath(label, path)} contains a non-JSON array property.`,
          );
        }
      }

      const clone = new Array(value.length);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          value,
          String(index),
        );
        if (!descriptor?.enumerable || !('value' in descriptor)) {
          throw new TypeError(
            `${formatPath(label, [...path, index])} must be a plain JSON array element.`,
          );
        }
        clone[index] = cloneValue(
          descriptor.value,
          label,
          [...path, index],
          ancestors,
        );
      }
      return clone;
    }

    if (!isPlainObject(value)) {
      throw new TypeError(
        `${formatPath(label, path)} must be a plain JSON object.`,
      );
    }

    /** @type {Record<string, any>} */
    const clone = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') {
        throw new TypeError(
          `${formatPath(label, path)} contains a non-JSON symbol property.`,
        );
      }

      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !('value' in descriptor)) {
        throw new TypeError(
          `${formatPath(label, [...path, key])} must be a plain JSON property.`,
        );
      }

      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: cloneValue(descriptor.value, label, [...path, key], ancestors),
        writable: true,
      });
    }
    return clone;
  } finally {
    ancestors.delete(objectValue);
  }
}

/**
 * Validate and clone a value at Wharfie's durable JSON boundary.
 *
 * Unlike JSON.stringify, this rejects values that would be silently discarded
 * or coerced. Shared references are cloned independently; only reference cycles
 * are rejected.
 * @param {unknown} value - Candidate JSON value.
 * @param {string} [label] - Boundary label used in validation errors.
 * @returns {any} - Independent JSON value clone.
 */
export function cloneJsonValue(value, label = 'Value') {
  return cloneValue(value, label, [], new WeakSet());
}

/**
 * Validate and clone a JSON object (not null or an array).
 * @param {unknown} value - Candidate JSON object.
 * @param {string} [label] - Boundary label used in validation errors.
 * @returns {Record<string, any>} - Independent JSON object clone.
 */
export function cloneJsonObject(value, label = 'Value') {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return cloneJsonValue(value, label);
}

export default { cloneJsonObject, cloneJsonValue };
