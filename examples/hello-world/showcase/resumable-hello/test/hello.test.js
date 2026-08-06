import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hello,
  main,
  prepareGreeting,
  sayHello,
  toDurableInput,
} from '../app/hello.js';

test('the ordinary CLI and durable adapter share greeting input', () => {
  assert.equal(hello(), 'Hello, world!');
  assert.deepEqual(toDurableInput(['  Ada  ']), { name: 'Ada' });

  let output = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = (value) => {
    output += value;
    return true;
  };
  try {
    assert.equal(main(['node', 'hello', 'Ada']), 'Hello, Ada!');
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.equal(output, 'Hello, Ada!\n');
});

test('the two activities pass one prepared greeting through the timer', () => {
  /** @type {Array<{message: string, fields: Record<string, string>}>} */
  const logs = [];
  /** @type {{logger: {info: (message: string, fields: Record<string, string>) => void}}} */
  const runtime = {
    logger: {
      info(message, fields) {
        logs.push({ message, fields });
      },
    },
  };

  const prepared = prepareGreeting({ name: 'Ada' }, runtime);
  assert.deepEqual(prepared, { name: 'Ada', message: 'Hello, Ada!' });
  assert.equal(sayHello(prepared, runtime), 'Hello, Ada!');
  assert.deepEqual(logs, [
    { message: 'Prepared greeting', fields: { name: 'Ada' } },
    { message: 'Completed greeting', fields: { name: 'Ada' } },
  ]);
});

test('invalid names and altered prepared greetings are rejected', () => {
  assert.throws(() => toDurableInput(['Ada', 'Lovelace']), /Usage/);
  assert.throws(() => toDurableInput(['   ']), /Usage/);
  assert.throws(
    () =>
      sayHello(
        { name: 'Ada', message: 'Goodbye, Ada!' },
        { logger: { info() {} } },
      ),
    /prepared greeting is invalid/,
  );
});
