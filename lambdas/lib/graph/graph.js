'use strict';
const Op = require('./op');

class Graph {
  constructor() {
    this.adjacencyList = new Map(); // Outgoing edges
    this.incomingEdges = new Map(); // Incoming edges
  }

  /**
   * @param {Op} vertex -
   */
  addVertex(vertex) {
    if (!this.adjacencyList.has(vertex)) {
      this.adjacencyList.set(vertex.serialize(), []);
    }
    if (!this.incomingEdges.has(vertex)) {
      this.incomingEdges.set(vertex.serialize(), []);
    }
  }

  /**
   * @param {Op} origin -
   * @param {Op} destination -
   */
  addEdge(origin, destination) {
    if (
      !this.adjacencyList.has(origin) ||
      !this.adjacencyList.has(destination)
    ) {
      throw new Error('Vertex does not exist');
    }

    this.adjacencyList.get(origin).push(destination);
    this.incomingEdges.get(destination).push(origin);
  }

  getVertices() {
    return Array.from(this.adjacencyList.keys());
  }

  /**
   * @param {Op} vertex -
   * @returns {Op[]} -
   */
  getEdges(vertex) {
    return this.adjacencyList.get(vertex) || [];
  }

  /**
   * @param {Op} vertex -
   * @returns {Op[]} -
   */
  getDownstreamVertices(vertex) {
    if (!this.adjacencyList.has(vertex)) {
      throw new Error('Vertex does not exist');
    }
    return this.adjacencyList.get(vertex).slice();
  }

  /**
   * @param {Op} vertex -
   * @returns {Op[]} -
   */
  getUpstreamVertices(vertex) {
    if (!this.incomingEdges.has(vertex)) {
      throw new Error('Vertex does not exist');
    }
    return this.incomingEdges.get(vertex).slice();
  }

  toString() {
    let result = '';
    for (const [vertex, edges] of this.adjacencyList) {
      const edgesList = edges.join(', ');
      result += `${vertex} -> ${edgesList}\n`;
    }
    return result;
  }

  serialize() {
    const adjacencyListObj = {};
    this.adjacencyList.forEach((edges, vertex) => {
      adjacencyListObj[vertex.serialize()] = edges.map((edge) =>
        edge.serialize()
      );
    });

    const incomingEdgesObj = {};
    this.incomingEdges.forEach((edges, vertex) => {
      incomingEdgesObj[vertex.serialize()] = edges.map((edge) =>
        edge.serialize()
      );
    });

    return JSON.stringify({
      adjacencyList: adjacencyListObj,
      incomingEdges: incomingEdgesObj,
    });
  }

  static deserialize(serializedGraph) {
    const parsedData = JSON.parse(serializedGraph);
    const graph = new Graph();

    for (const [serializedVertex, edges] of Object.entries(
      parsedData.adjacencyList
    )) {
      const vertex = Vertex.deserialize(serializedVertex);
      graph.addVertex(vertex);
      edges.forEach((serializedEdge) => {
        const edge = Vertex.deserialize(serializedEdge);
        graph.addEdge(vertex, edge);
      });
    }

    return graph;
  }
}

module.exports = Graph;
