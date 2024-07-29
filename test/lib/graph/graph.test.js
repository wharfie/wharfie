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
      `"{"id":"id-1","type":"cloudwatch","executions":[]}"`
    );
    expect(graph.serialize()).toMatchInlineSnapshot(
      `"{"outgoingEdges":[["id-1",[]]],"incomingEdges":[["id-1",[]]],"actions":[{"id":"id-1","type":"cloudwatch","executions":[]}]}"`
    );
  });
  it('deserialization', async () => {
    expect.assertions(3);
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
      `"{"outgoingEdges":[["id-1",["id-2"]],["id-2",["id-3"]],["id-3",[]]],"incomingEdges":[["id-1",[]],["id-2",["id-1"]],["id-3",["id-2"]]],"actions":[{"id":"id-1","type":"first","executions":[]},{"id":"id-2","type":"second","executions":[]},{"id":"id-3","type":"third","executions":[]}]}"`
    );
    expect(OperationActionGraph.deserialize(serializedGraph))
      .toMatchInlineSnapshot(`
      OperationActionGraph {
        "actions": [
          Action {
            "executions": [],
            "id": "id-1",
            "type": "first",
          },
          Action {
            "executions": [],
            "id": "id-2",
            "type": "second",
          },
          Action {
            "executions": [],
            "id": "id-3",
            "type": "third",
          },
        ],
        "incomingEdges": Map {
          "id-1" => [],
          "id-2" => [
            "id-1",
          ],
          "id-3" => [
            "id-2",
          ],
        },
        "outgoingEdges": Map {
          "id-1" => [
            "id-2",
          ],
          "id-2" => [
            "id-3",
          ],
          "id-3" => [],
        },
      }
    `);
    expect(OperationActionGraph.deserialize(serializedGraph)).toStrictEqual(
      graph
    );
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
      "first -> secondA, secondB
      secondA -> third
      secondB -> third
      third
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
    expect(graph.getUpstreamActions(first)).toMatchInlineSnapshot(`[]`);
    expect(graph.getUpstreamActions(third)).toMatchInlineSnapshot(`
      [
        Action {
          "executions": [],
          "id": "id-2",
          "type": "secondA",
        },
        Action {
          "executions": [],
          "id": "id-3",
          "type": "secondB",
        },
      ]
    `);
    expect(graph.getUpstreamActions(secondA)).toMatchInlineSnapshot(`
      [
        Action {
          "executions": [],
          "id": "id-1",
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
      [
        Action {
          "executions": [],
          "id": "id-2",
          "type": "secondA",
        },
        Action {
          "executions": [],
          "id": "id-3",
          "type": "secondB",
        },
      ]
    `);
    expect(graph.getDownstreamActions(secondA)).toMatchInlineSnapshot(`
      [
        Action {
          "executions": [],
          "id": "id-4",
          "type": "third",
        },
      ]
    `);
    expect(graph.getDownstreamActions(third)).toMatchInlineSnapshot(`[]`);
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
      [
        Action {
          "executions": [],
          "id": "id-1",
          "type": "first",
        },
        Action {
          "executions": [],
          "id": "id-2",
          "type": "secondA",
        },
        Action {
          "executions": [],
          "id": "id-3",
          "type": "secondB",
        },
        Action {
          "executions": [],
          "id": "id-4",
          "type": "third",
        },
      ]
    `);
  });
});
