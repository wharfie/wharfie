const Joi = require('joi');

/**
 * A dynamic schema that accepts either an object or a string.
 * @type {Joi.Schema}
 */
const dynamicSchema = Joi.alternatives()
  .try(Joi.object(), Joi.string())
  .required();

/**
 * Maps a type string to a corresponding Joi schema.
 * @param {string} typeStr - The type string to convert (e.g., 'string', 'number', 'boolean', 'secret').
 * @returns {Joi.Schema} The Joi schema corresponding to the given type.
 * @throws {Error} Throws an error if the type is unsupported.
 */
function mapType(typeStr) {
  switch (typeStr) {
    case 'string':
      return Joi.string();
    case 'number':
      return Joi.number();
    case 'boolean':
      return Joi.boolean();
    case 'secret':
      return Joi.alternatives().try(
        Joi.string(),
        Joi.object({ ref: Joi.string() }),
      );
    default:
      throw new Error(`Unsupported type: ${typeStr}`);
  }
}

/**
 * Generates a Joi configuration schema based on a provided definition.
 * The definition can be a string, an array (with one element), or an object.
 * @param {string|Object|Array<string|Object>} definition - The configuration definition.
 * @returns {Joi.Schema} The generated Joi schema.
 * @throws {Error} If the definition format is invalid or if an array does not contain exactly one element.
 */
function generateConfigSchema(definition) {
  if (typeof definition === 'string') {
    return mapType(definition);
  } else if (Array.isArray(definition)) {
    if (definition.length !== 1) {
      throw new Error('Array type definition should have exactly one element.');
    }
    return Joi.array().items(generateConfigSchema(definition[0]).required());
  } else if (typeof definition === 'object' && definition !== null) {
    /** @type {Object<string, Joi.Schema>} */
    const objKeys = {};
    if ('type' in definition && typeof definition.type === 'string') {
      switch (definition.type) {
        case 'object':
          if (
            'properties' in definition &&
            typeof definition.properties === 'object' &&
            definition.properties !== null
          ) {
            for (const [key, value] of Object.entries(definition.properties)) {
              objKeys[key] = generateConfigSchema(value).required();
            }
          }
          return Joi.object(objKeys);
        case 'array':
          if ('items' in definition && definition.items) {
            return Joi.array().items(
              generateConfigSchema(definition.items).required(),
            );
          }
          throw new Error('Array type definition must have an "items" field.');
        default:
          return mapType(definition.type);
      }
    } else {
      for (const [key, value] of Object.entries(definition)) {
        objKeys[key] = generateConfigSchema(value).required();
      }
      return Joi.object(objKeys);
    }
  }
  throw new Error('Invalid configuration definition format.');
}

module.exports = {
  dynamicSchema,
  generateConfigSchema,
};
