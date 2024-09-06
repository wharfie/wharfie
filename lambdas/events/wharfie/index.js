const scheduler = require('./scheduler');
const router = require('./router');

module.exports = {
  scheduler: scheduler.run,
  router: router.run,
};
