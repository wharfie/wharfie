const dep = require('../lib/dep');

module.exports.handler = (event, context) => {
  console.log('started');
  console.log(event);
  console.log(context);
  console.log('HELLO AMY FROM A BINARY');
  dep();
  setTimeout(() => {
    console.log('timeout');
  }, 1000);
};
