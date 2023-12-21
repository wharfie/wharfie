const logging = require('../../lib/logging');
const wharfie_db_log = logging.getWharfieDBLogger();
/**
 *
 * @param {import('../../typedefs').ResourceRecord} resource -
 * @param {import('../../typedefs').OperationRecord} operation -
 * @param {Number} completed_at -
 */
async function wharfie(resource, operation, completed_at) {
  wharfie_db_log.info('wharfie', {
    resource,
    operation,
    completed_at,
  });
}

module.exports = wharfie;
