const cuid = require('@paralleldrive/cuid2');

// configuration. All configuration properties are optional.
const createId = cuid.init();
const createShortId = cuid.init({
  length: 6,
});

module.exports = {
  createId,
  createShortId,
};
