'use strict';
const Op = require('./op');

class Graph {
  constructor() {
    /**
     * @type {Op[]}
     */
    this.ops = [];
    /**
     * @type {Map<string, string[]>}
     */
    this.adjacencyList = new Map(); // Outgoing edges
    /**
     * @type {Map<string, string[]>}
     */
    this.incomingEdges = new Map(); // Incoming edges
  }

  /**
   * @param {Op} op -
   */
  addOp(op) {
    if (!this.adjacencyList.has(op.id)) {
      this.adjacencyList.set(op.serialize(), []);
    }
    if (!this.incomingEdges.has(op.id)) {
      this.incomingEdges.set(op.serialize(), []);
    }
  }

  /**
   * @param {Op} originOp -
   * @param {Op} destinationOp -
   */
  addDependency(originOp, destinationOp) {
    if (
      !this.adjacencyList.has(originOp.id) ||
      !this.adjacencyList.has(destinationOp.id)
    ) {
      throw new Error('Op does not exist');
    }

    (this.adjacencyList.get(originOp.id) || []).push(destinationOp.id);
    (this.incomingEdges.get(destinationOp.id) || []).push(originOp.id);
  }

  /**
   * @returns {Op[]} -
   */
  getOps() {
    return this.ops;
  }

  /**
   * @param {string} name -
   * @returns {Op} -
   */
  getOp(name) {
    const matchedOp = this.ops.filter((op) => op.id === name)[0];
    if (!matchedOp) {
      throw new Error(`Op ${name} does not exist`);
    }
    return matchedOp;
  }

  /**
   * @param {Op} op -
   * @returns {Op[]} -
   */
  getDependencies(op) {
    return (this.adjacencyList.get(op.id) || []).map((name) =>
      this.getOp(name)
    );
  }

  /**
   * @param {Op} op -
   * @returns {Op[]} -
   */
  getDownstreamOps(op) {
    if (!this.adjacencyList.has(op.id)) {
      throw new Error('Vertex does not exist');
    }
    return (this.adjacencyList.get(op.id) || []).map((name) =>
      this.getOp(name)
    );
  }

  /**
   * @param {Op} op -
   * @returns {Op[]} -
   */
  getUpstreamOps(op) {
    if (!this.incomingEdges.has(op.id)) {
      throw new Error('Vertex does not exist');
    }

    return (this.incomingEdges.get(op.id) || []).map((name) =>
      this.getOp(name)
    );
  }

  /**
   * @returns {string} -
   */
  toString() {
    let result = '';
    for (const [opName, Dependencies] of this.adjacencyList) {
      const DependencyList = Dependencies.join(', ');
      if (DependencyList.length > 0) {
        result += `${opName} -> ${DependencyList}\n`;
      } else {
        result += `${opName}\n`;
      }
    }
    return result;
  }

  /**
   * @returns {string} -
   */
  serialize() {
    return JSON.stringify({
      adjacencyList: this.adjacencyList,
      incomingEdges: this.incomingEdges,
      ops: this.ops.map((op) => op.serialize()),
    });
  }

  /**
   * @param {string} serializedGraph -
   * @returns {Graph} -
   */
  static deserialize(serializedGraph) {
    const parsedData = JSON.parse(serializedGraph);
    const graph = new Graph();

    for (const serializedOp of parsedData.ops) {
      const op = Op.deserialize(serializedOp);
      graph.addOp(op);
    }
    for (const [opName, dependencies] of Object.entries(
      parsedData.adjacencyList
    )) {
      dependencies.forEach((/** @type {string} */ dependency) => {
        graph.addDependency(graph.getOp(dependency), graph.getOp(opName));
      });
    }

    return graph;
  }
}

module.exports = Graph;
