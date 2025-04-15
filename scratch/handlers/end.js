const dep = require('../lib/dep');
// const lmdb = require('lmdb');

// const ROOT_DB = lmdb.open({
//   path: './',
// });

module.exports.handler = (context) => {
  dep();
  console.log('end');
};
