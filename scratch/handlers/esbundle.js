const __getOwnPropNames = Object.getOwnPropertyNames;
const __commonJS = (cb, mod) =>
  function __require() {
    return (
      mod ||
        (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod),
      mod.exports
    );
  };

// scratch/lib/dep.js
const require_dep = __commonJS({
  'scratch/lib/dep.js'(exports2, module2) {
    'use strict';
    module2.exports = () => {
      console.log('dependency');
    };
  },
});

// scratch/handlers/index.js
const dep = require_dep();
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
// # sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vbGliL2RlcC5qcyIsICJpbmRleC5qcyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsibW9kdWxlLmV4cG9ydHMgPSAoKSA9PiB7XG4gIGNvbnNvbGUubG9nKCdkZXBlbmRlbmN5Jyk7XG59O1xuIiwgImNvbnN0IGRlcCA9IHJlcXVpcmUoJy4uL2xpYi9kZXAnKTtcbi8vIGNvbnN0IGJjcnlwdCA9IHJlcXVpcmUoJ2JjcnlwdCcpO1xuXG5cbihhc3luYyAoKSA9PiB7XG4gICAgY29uc29sZS5sb2codHlwZW9mIHJlcXVpcmUoXCJhY3R1YWwtY3Jhc2hcIikuY3Jhc2gpXG4gICAgY29uc29sZS5sb2coXCJoZWxsbyB3b3JsZFwiKVxuICAgIGNvbnN0IGxtZGIgPSByZXF1aXJlKCdsbWRiJyk7XG4gICAgY29uc3QgUk9PVF9EQiA9IGxtZGIub3Blbih7XG4gICAgICAgIHBhdGg6ICd0ZXN0LWRiJyxcbiAgICB9KTtcbiAgICBjb25zb2xlLmxvZygnaGVsbG8gd29ybGQnKVxuICAgIGRlcCgpO1xuICAgIGF3YWl0IFJPT1RfREIucHV0KCdncmVldGluZycsIHsgc29tZVRleHQ6ICdIZWxsbywgV29ybGQhJyB9KTtcbiAgICBjb25zb2xlLmxvZyhST09UX0RCLmdldCgnZ3JlZXRpbmcnKS5zb21lVGV4dClcbn0pKCk7Il0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7O0FBQUE7QUFBQSx1QkFBQUEsVUFBQUMsU0FBQTtBQUFBO0FBQUEsSUFBQUEsUUFBTyxVQUFVLE1BQU07QUFDckIsY0FBUSxJQUFJLFlBQVk7QUFBQSxJQUMxQjtBQUFBO0FBQUE7OztBQ0ZBLElBQU0sTUFBTTtBQUFBLENBSVgsWUFBWTtBQUNULFVBQVEsSUFBSSxPQUFPLFFBQVEsY0FBYyxFQUFFLEtBQUs7QUFDaEQsVUFBUSxJQUFJLGFBQWE7QUFDekIsUUFBTSxPQUFPLFFBQVEsTUFBTTtBQUMzQixRQUFNLFVBQVUsS0FBSyxLQUFLO0FBQUEsSUFDdEIsTUFBTTtBQUFBLEVBQ1YsQ0FBQztBQUNELFVBQVEsSUFBSSxhQUFhO0FBQ3pCLE1BQUk7QUFDSixRQUFNLFFBQVEsSUFBSSxZQUFZLEVBQUUsVUFBVSxnQkFBZ0IsQ0FBQztBQUMzRCxVQUFRLElBQUksUUFBUSxJQUFJLFVBQVUsRUFBRSxRQUFRO0FBQ2hELEdBQUc7IiwKICAibmFtZXMiOiBbImV4cG9ydHMiLCAibW9kdWxlIl0KfQo=
