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
 * @param {number | undefined} maxBytes - Optional encoded JSON byte limit.
 * @param {string} label - Boundary label.
 * @returns {{maxBytes: number, usedBytes: number} | undefined} - Mutable byte budget.
 */
function createByteBudget(maxBytes, label) {
  if (maxBytes === undefined) return undefined;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError(
      `${label} byte limit must be a nonnegative safe integer.`,
    );
  }
  return { maxBytes, usedBytes: 0 };
}

/**
 * Account for encoded JSON bytes while cloning. This keeps a bounded caller
 * from allocating a complete clone before its byte limit is checked.
 * @param {{maxBytes: number, usedBytes: number} | undefined} budget - Optional byte budget.
 * @param {number} byteCount - Number of exact serialized UTF-8 bytes.
 * @param {string} label - Boundary label.
 * @returns {void}
 */
function consumeJsonByteCount(budget, byteCount, label) {
  if (!budget) return;
  budget.usedBytes += byteCount;
  if (budget.usedBytes > budget.maxBytes) {
    throw new RangeError(
      `${label} encoded JSON must not exceed ${budget.maxBytes} bytes.`,
    );
  }
}

/**
 * Account for one already-serialized JSON fragment while cloning.
 * @param {{maxBytes: number, usedBytes: number} | undefined} budget - Optional byte budget.
 * @param {string} fragment - Exact JSON fragment.
 * @param {string} label - Boundary label.
 * @returns {void}
 */
function consumeJsonBytes(budget, fragment, label) {
  consumeJsonByteCount(budget, Buffer.byteLength(fragment, 'utf8'), label);
}

/**
 * Account for the exact JSON encoding of a string without first allocating an
 * escaped copy of an oversized input string.
 * @param {{maxBytes: number, usedBytes: number} | undefined} budget - Optional byte budget.
 * @param {string} value - String being serialized.
 * @param {string} label - Boundary label.
 * @returns {void}
 */
function consumeJsonStringBytes(budget, value, label) {
  if (!budget) return;
  // Opening and closing JSON quotes.
  consumeJsonByteCount(budget, 2, label);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      consumeJsonByteCount(budget, 2, label);
    } else if (
      code === 0x08 ||
      code === 0x09 ||
      code === 0x0a ||
      code === 0x0c ||
      code === 0x0d
    ) {
      consumeJsonByteCount(budget, 2, label);
    } else if (code < 0x20) {
      consumeJsonByteCount(budget, 6, label);
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        consumeJsonByteCount(budget, 4, label);
        index += 1;
      } else {
        // JSON.stringify's well-formed JSON behavior escapes lone surrogates.
        consumeJsonByteCount(budget, 6, label);
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      // JSON.stringify's well-formed JSON behavior escapes lone surrogates.
      consumeJsonByteCount(budget, 6, label);
    } else if (code < 0x80) {
      consumeJsonByteCount(budget, 1, label);
    } else if (code < 0x800) {
      consumeJsonByteCount(budget, 2, label);
    } else {
      consumeJsonByteCount(budget, 3, label);
    }
  }
}

/**
 * @param {unknown} value - Candidate JSON value.
 * @param {string} label - Boundary label.
 * @param {(string | number)[]} path - Path segments.
 * @param {WeakSet<object>} ancestors - Objects on the active traversal path.
 * @param {{maxBytes: number, usedBytes: number} | undefined} budget - Optional encoded JSON byte budget.
 * @returns {any} - Cloned JSON value.
 */
function cloneValue(value, label, path, ancestors, budget) {
  if (value === null) {
    consumeJsonBytes(budget, 'null', label);
    return null;
  }

  switch (typeof value) {
    case 'string':
      consumeJsonStringBytes(budget, value, label);
      return value;
    case 'boolean':
      consumeJsonBytes(budget, value ? 'true' : 'false', label);
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
      consumeJsonBytes(budget, JSON.stringify(value), label);
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

      if (budget && value.length > budget.maxBytes) {
        throw new RangeError(
          `${label} encoded JSON must not exceed ${budget.maxBytes} bytes.`,
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
      consumeJsonBytes(budget, '[', label);
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
        if (index > 0) consumeJsonBytes(budget, ',', label);
        clone[index] = cloneValue(
          descriptor.value,
          label,
          [...path, index],
          ancestors,
          budget,
        );
      }
      consumeJsonBytes(budget, ']', label);
      return clone;
    }

    if (!isPlainObject(value)) {
      throw new TypeError(
        `${formatPath(label, path)} must be a plain JSON object.`,
      );
    }

    /** @type {Record<string, any>} */
    const clone = {};
    let propertyCount = 0;
    consumeJsonBytes(budget, '{', label);
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

      if (propertyCount > 0) consumeJsonBytes(budget, ',', label);
      consumeJsonStringBytes(budget, key, label);
      consumeJsonBytes(budget, ':', label);

      Object.defineProperty(clone, key, {
        configurable: true,
        enumerable: true,
        value: cloneValue(
          descriptor.value,
          label,
          [...path, key],
          ancestors,
          budget,
        ),
        writable: true,
      });
      propertyCount += 1;
    }
    consumeJsonBytes(budget, '}', label);
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
  return cloneValue(value, label, [], new WeakSet(), undefined);
}

/**
 * Validate and clone JSON without first allocating a complete clone that is
 * larger than the caller's encoded-byte limit.
 * @param {unknown} value - Candidate JSON value.
 * @param {number} maxBytes - Maximum UTF-8 bytes in its exact JSON encoding.
 * @param {string} [label] - Boundary label used in validation errors.
 * @returns {any} - Independent bounded JSON value clone.
 */
export function cloneBoundedJsonValue(value, maxBytes, label = 'Value') {
  return cloneValue(
    value,
    label,
    [],
    new WeakSet(),
    createByteBudget(maxBytes, label),
  );
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

/**
 * Validate and clone a JSON object within an encoded-byte limit.
 * @param {unknown} value - Candidate JSON object.
 * @param {number} maxBytes - Maximum UTF-8 bytes in its exact JSON encoding.
 * @param {string} [label] - Boundary label used in validation errors.
 * @returns {Record<string, any>} - Independent bounded JSON object clone.
 */
export function cloneBoundedJsonObject(value, maxBytes, label = 'Value') {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return cloneBoundedJsonValue(value, maxBytes, label);
}

export default {
  cloneBoundedJsonObject,
  cloneBoundedJsonValue,
  cloneJsonObject,
  cloneJsonValue,
};
