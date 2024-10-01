'use strict';
const processor = require('./processor');

/**
 * @param {import('../../typedefs').InputEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @returns {Promise<void>}
 */
async function router(event, context) {
  await processor.run(event, context);
}

module.exports = router;
