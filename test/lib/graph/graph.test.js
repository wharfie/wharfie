/* eslint-disable jest/no-hooks */
'use strict';

const { Action, OperationActionGraph } = require('../../../lambdas/lib/graph');

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
  it('serialization', async () => {
    expect.assertions(2);
    const graph = new OperationActionGraph();
    const newAction = new Action({
      type: 'cloudwatch',
    });
    graph.addAction(newAction);

    expect(newAction.serialize()).toMatchInlineSnapshot(
      `"{\\"id\\":\\"id-1\\",\\"type\\":\\"cloudwatch\\",\\"status\\":\\"WAITING\\",\\"executions\\":[]}"`
    );
    expect(graph.serialize()).toMatchInlineSnapshot(
      `"{\\"adjacencyList\\":[[\\"id-1\\",[]]],\\"incomingEdges\\":[[\\"id-1\\",[]]],\\"actions\\":[{\\"id\\":\\"id-1\\",\\"type\\":\\"cloudwatch\\",\\"status\\":\\"WAITING\\",\\"executions\\":[]}]}"`
    );
  });
  it('deserialization', async () => {
    expect.assertions(2);
    const graph = new OperationActionGraph();
    const first = new Action({
      type: 'first',
    });
    const second = new Action({
      type: 'second',
    });
    const third = new Action({
      type: 'third',
    });
    graph.addAction(first);
    graph.addAction(second);
    graph.addAction(third);
    graph.addDependency(first, second);
    graph.addDependency(second, third);
    const serializedGraph = graph.serialize();
    expect(serializedGraph).toMatchInlineSnapshot(
      `"{\\"adjacencyList\\":[[\\"id-1\\",[\\"id-2\\"]],[\\"id-2\\",[\\"id-3\\"]],[\\"id-3\\",[]]],\\"incomingEdges\\":[[\\"id-1\\",[]],[\\"id-2\\",[\\"id-1\\"]],[\\"id-3\\",[\\"id-2\\"]]],\\"actions\\":[{\\"id\\":\\"id-1\\",\\"type\\":\\"first\\",\\"status\\":\\"WAITING\\",\\"executions\\":[]},{\\"id\\":\\"id-2\\",\\"type\\":\\"second\\",\\"status\\":\\"WAITING\\",\\"executions\\":[]},{\\"id\\":\\"id-3\\",\\"type\\":\\"third\\",\\"status\\":\\"WAITING\\",\\"executions\\":[]}]}"`
    );
    expect(OperationActionGraph.deserialize(serializedGraph))
      .toMatchInlineSnapshot(`
      OperationActionGraph {
        "actions": Array [
          Action {
            "executions": Array [],
            "id": "id-1",
            "status": "WAITING",
            "type": "first",
          },
          Action {
            "executions": Array [],
            "id": "id-2",
            "status": "WAITING",
            "type": "second",
          },
          Action {
            "executions": Array [],
            "id": "id-3",
            "status": "WAITING",
            "type": "third",
          },
        ],
        "adjacencyList": Map {
          "id-1" => Array [],
          "id-2" => Array [
            "id-1",
          ],
          "id-3" => Array [
            "id-2",
          ],
        },
        "incomingEdges": Map {
          "id-1" => Array [
            "id-2",
          ],
          "id-2" => Array [
            "id-3",
          ],
          "id-3" => Array [],
        },
      }
    `);
  });
  it('toString', async () => {
    expect.assertions(1);
    const graph = new OperationActionGraph();
    const first = new Action({
      type: 'first',
    });
    const secondA = new Action({
      type: 'secondA',
    });
    const secondB = new Action({
      type: 'secondB',
    });
    const third = new Action({
      type: 'third',
    });
    graph.addAction(first);
    graph.addAction(secondA);
    graph.addAction(secondB);
    graph.addAction(third);
    graph.addDependency(first, secondA);
    graph.addDependency(secondA, third);
    graph.addDependency(first, secondB);
    graph.addDependency(secondB, third);
    expect(graph.toString()).toMatchInlineSnapshot(`
      "id-1 -> id-2, id-3
      id-2 -> id-4
      id-3 -> id-4
      id-4
      "
    `);
  });
  it('getUpstreamActions', async () => {
    expect.assertions(3);
    const graph = new OperationActionGraph();
    const first = new Action({
      type: 'first',
    });
    const secondA = new Action({
      type: 'secondA',
    });
    const secondB = new Action({
      type: 'secondB',
    });
    const third = new Action({
      type: 'third',
    });
    graph.addAction(first);
    graph.addAction(secondA);
    graph.addAction(secondB);
    graph.addAction(third);
    graph.addDependency(first, secondA);
    graph.addDependency(secondA, third);
    graph.addDependency(first, secondB);
    graph.addDependency(secondB, third);
    expect(graph.getUpstreamActions(first)).toMatchInlineSnapshot(`Array []`);
    expect(graph.getUpstreamActions(third)).toMatchInlineSnapshot(`
      Array [
        Action {
          "executions": Array [],
          "id": "id-2",
          "status": "WAITING",
          "type": "secondA",
        },
        Action {
          "executions": Array [],
          "id": "id-3",
          "status": "WAITING",
          "type": "secondB",
        },
      ]
    `);
    expect(graph.getUpstreamActions(secondA)).toMatchInlineSnapshot(`
      Array [
        Action {
          "executions": Array [],
          "id": "id-1",
          "status": "WAITING",
          "type": "first",
        },
      ]
    `);
  });
  it('getDownstreamActions', async () => {
    expect.assertions(3);
    const graph = new OperationActionGraph();
    const first = new Action({
      type: 'first',
    });
    const secondA = new Action({
      type: 'secondA',
    });
    const secondB = new Action({
      type: 'secondB',
    });
    const third = new Action({
      type: 'third',
    });
    graph.addAction(first);
    graph.addAction(secondA);
    graph.addAction(secondB);
    graph.addAction(third);
    graph.addDependency(first, secondA);
    graph.addDependency(secondA, third);
    graph.addDependency(first, secondB);
    graph.addDependency(secondB, third);
    expect(graph.getDownstreamActions(first)).toMatchInlineSnapshot(`
      Array [
        Action {
          "executions": Array [],
          "id": "id-2",
          "status": "WAITING",
          "type": "secondA",
        },
        Action {
          "executions": Array [],
          "id": "id-3",
          "status": "WAITING",
          "type": "secondB",
        },
      ]
    `);
    expect(graph.getDownstreamActions(secondA)).toMatchInlineSnapshot(`
      Array [
        Action {
          "executions": Array [],
          "id": "id-4",
          "status": "WAITING",
          "type": "third",
        },
      ]
    `);
    expect(graph.getDownstreamActions(third)).toMatchInlineSnapshot(`Array []`);
  });
  it('getSequentialActionOrder', async () => {
    expect.assertions(1);
    const graph = new OperationActionGraph();
    const first = new Action({
      type: 'first',
    });
    const secondA = new Action({
      type: 'secondA',
    });
    const secondB = new Action({
      type: 'secondB',
    });
    const third = new Action({
      type: 'third',
    });
    graph.addAction(first);
    graph.addAction(secondA);
    graph.addAction(secondB);
    graph.addAction(third);
    graph.addDependency(first, secondA);
    graph.addDependency(secondA, third);
    graph.addDependency(first, secondB);
    graph.addDependency(secondB, third);
    expect(graph.getSequentialActionOrder()).toMatchInlineSnapshot(`
      Array [
        "first",
        "secondA",
        "secondB",
        "third",
      ]
    `);
  });
});
