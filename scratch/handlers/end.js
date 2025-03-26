const dep = require('../lib/dep');

module.exports.handler = (context) => {
  dep();
  console.log('end');
};
