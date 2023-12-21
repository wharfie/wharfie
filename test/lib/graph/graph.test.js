/* eslint-disable jest/no-hooks */
'use strict';

const { Op, Graph } = require('../../../lambdas/lib/graph');

describe('tests for graph', () => {
  it('basic', async () => {
    expect.assertions(1);
    const graph = new Graph();
    graph.addOp(new Op('cloudwatch'));

    expect(graph.toString()).toMatchInlineSnapshot('');
  });
});
