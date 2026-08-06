import assert from 'node:assert/strict';
import test from 'node:test';

import { hello } from '../app/hello.js';

test('says hello', () => {
  assert.equal(hello(), 'Hello, world!');
  assert.equal(hello('Ada'), 'Hello, Ada!');
});
