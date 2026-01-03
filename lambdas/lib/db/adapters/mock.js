// eslint-disable-next-line node/no-unpublished-import
import { jest } from '@jest/globals';

/**
 * @returns {import('../base.js').DBClient} -
 */
export default function createMockDB() {
  const query = jest.fn(async (_params) => {
    return [];
  });

  const batchWrite = jest.fn(async (_params) => {
    // no-op
  });

  const update = jest.fn(async (_params) => {
    // no-op
  });

  const put = jest.fn(async (_params) => {
    // no-op
  });

  const get = jest.fn(async (_params) => {
    return undefined;
  });

  const remove = jest.fn(async (_params) => {
    // no-op
  });

  const close = jest.fn(async () => {
    // no-op
  });

  return {
    query,
    put,
    update,
    get,
    remove,
    batchWrite,
    close,
  };
}
