'use strict';
const Action = require('./action');

class OperationActionGraph {
  constructor() {
    /**
     * @type {Action[]}
     */
    this.actions = [];
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
   * @param {Action} action -
   */
  addAction(action) {
    if (!this.adjacencyList.has(action.id)) {
      this.adjacencyList = this.adjacencyList.set(action.id, []);
    }
    if (!this.incomingEdges.has(action.id)) {
      this.incomingEdges = this.incomingEdges.set(action.id, []);
    }
    this.actions.push(action);
  }

  /**
   * @param {Action[]} actions -
   */
  addActions(actions) {
    actions.forEach(this.addAction.bind(this));
  }

  /**
   * @param {Action} originAction -
   * @param {Action} destinationAction -
   */
  addDependency(originAction, destinationAction) {
    if (!this.adjacencyList.has(originAction.id)) {
      throw new Error(`Action ${originAction} does not exist`);
    }
    if (!this.adjacencyList.has(destinationAction.id)) {
      throw new Error(`Action ${destinationAction} does not exist`);
    }

    (this.adjacencyList.get(originAction.id) || []).push(destinationAction.id);
    (this.incomingEdges.get(destinationAction.id) || []).push(originAction.id);
  }

  /**
   * @returns {Action[]} -
   */
  getActions() {
    return this.actions;
  }

  /**
   * @param {string} id -
   * @returns {Action} -
   */
  getAction(id) {
    const matchedAction = this.actions.filter((action) => action.id === id)[0];
    if (!matchedAction) {
      throw new Error(`Action ${id} does not exist`);
    }
    return matchedAction;
  }

  /**
   * @param {string} type -
   * @returns {Action} -
   */
  getActionByType(type) {
    const matchedAction = this.actions.filter(
      (action) => action.type === type
    )[0];
    if (!matchedAction) {
      throw new Error(`Action ${type} does not exist`);
    }
    return matchedAction;
  }

  /**
   * @param {Action} action -
   * @returns {Action[]} -
   */
  getDownstreamActions(action) {
    if (!this.adjacencyList.has(action.id)) {
      throw new Error('Action does not exist');
    }
    return (this.adjacencyList.get(action.id) || []).map((id) =>
      this.getAction(id)
    );
  }

  /**
   * @param {Action} action -
   * @returns {Action[]} -
   */
  getUpstreamActions(action) {
    if (!this.incomingEdges.has(action.id)) {
      throw new Error('Action does not exist');
    }

    return (this.incomingEdges.get(action.id) || []).map((id) =>
      this.getAction(id)
    );
  }

  /**
   * @returns {string} -
   */
  toString() {
    let result = '';
    for (const [actionName, Dependencies] of this.adjacencyList) {
      const DependencyList = Dependencies.join(', ');
      if (DependencyList.length > 0) {
        result += `${actionName} -> ${DependencyList}\n`;
      } else {
        result += `${actionName}\n`;
      }
    }
    return result;
  }

  /**
   * @returns {Action[]} -
   */
  getSequentialActionOrder() {
    const actions = this.getActions();
    /**
     * @type {Action[]}
     */
    const actionOrder = [];
    const visited = new Set();
    /**
     * @type {Action[]}
     */
    const queue = [];

    /**
     * @param {Action} action -
     * @this {OperationActionGraph}
     */
    function bfs(action) {
      queue.push(action);

      while (queue.length > 0) {
        const currentAction = queue.shift();
        if (!currentAction) {
          throw new Error('Queue should not be empty');
        }
        if (visited.has(currentAction.id)) {
          continue;
        }
        visited.add(currentAction.id);
        actionOrder.push(currentAction);

        const downstreamActions = this.getDownstreamActions(currentAction);
        for (const dependency of downstreamActions) {
          if (!visited.has(dependency.id)) {
            queue.push(dependency);
          }
        }
      }
    }

    for (const action of actions) {
      if (!visited.has(action.id)) {
        bfs.call(this, action);
      }
    }

    return actionOrder;
  }

  /**
   * @returns {string} -
   */
  serialize() {
    return JSON.stringify({
      adjacencyList: Array.from(this.adjacencyList.entries()),
      incomingEdges: Array.from(this.incomingEdges.entries()),
      actions: this.actions,
    });
  }

  /**
   * @param {string} serializedGraph -
   * @returns {OperationActionGraph} -
   */
  static deserialize(serializedGraph) {
    const parsedData = JSON.parse(serializedGraph);
    const graph = new OperationActionGraph();
    for (const parsedAction of parsedData.actions) {
      const action = Action.fromRecord({
        action_id: parsedAction.id,
        action_type: parsedAction.type,
        action_status: parsedAction.status,
      });
      graph.addAction(action);
    }
    for (const [actionId, dependencies] of parsedData.adjacencyList) {
      dependencies.forEach((/** @type {string} */ dependency) => {
        graph.addDependency(
          graph.getAction(dependency),
          graph.getAction(actionId)
        );
      });
    }

    return graph;
  }
}

module.exports = OperationActionGraph;
