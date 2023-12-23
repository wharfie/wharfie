/* eslint-disable jest/no-hooks */
'use strict';

const { Op, Graph } = require('../../../lambdas/lib/graph');

const { createId } = require('../../../lambdas/lib/id');
jest.mock('../../../lambdas/lib/id');

let idCount;
describe('tests for graph', () => {
  beforeEach(() => {
    idCount = 0;
    createId.mockImplementation(() => {
      idCount = idCount + 1;
      return `id-${idCount}`;
    });
  });
  afterAll(() => {
    createId.mockClear();
  });
  it('basic', async () => {
    expect.assertions(1);
    const graph = new Graph();
    graph.addOp(new Op('cloudwatch'));

    expect(graph.toString()).toMatchInlineSnapshot(`
      "{\\"id\\":\\"id-1\\",\\"status\\":\\"WAITING\\",\\"executions\\":[]}
      "
    `);
  });
});
