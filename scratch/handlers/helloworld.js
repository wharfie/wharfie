const dep = require('../lib/dep');
// const bcrypt = require('bcrypt');

(async () => {
  console.log(typeof require('actual-crash').crash);
  console.log('hello world');
  const lmdb = require('lmdb');
  const ROOT_DB = lmdb.open({
    path: 'test-db',
  });
  console.log('hello world');
  dep();
  await ROOT_DB.put('greeting', { someText: 'Hello, World!' });
  console.log(ROOT_DB.get('greeting').someText);
})();
