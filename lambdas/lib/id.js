const cuid = require('@paralleldrive/cuid2');

// configuration. All configuration properties are optional.
const createId = cuid.init();

module.exports = {
  createId,
};
