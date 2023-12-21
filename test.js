console.time('Benchmark');
const { createId } = require('./lambdas/lib/id');

// /**
//  *
//  * @param fn
//  */
// function query(fn) {
//     const name = fn.name;
//     // create query records
//     return function () {
//       console.log(`Query ${name} is called with arguments:`, arguments);
//       // lock query semaphore
//       // run query
//       const result = fn.apply(this, arguments);
//       // unlock query semaphore
//       // mark query record as complete
//       // Enqueue next Ops
//       console.log('Query returned:', result);
//       return result;
//     };
//   }
// }

class Execution {
  constructor(data = {}) {
    this.execution_id = data.execution_id || createId();
  }

  run() {
    // lock query semaphore
    // run query
    // unlock query semaphore
  }

  /**
   * @returns {string} -
   */
  serialize() {
    return JSON.stringify({ execution_id: this.execution_id });
  }

  /**
   * @param {string} serializedExecution -
   * @returns {Execution} -
   */
  static deserialize(serializedExecution) {
    const parsed = JSON.parse(serializedExecution);
    return new Execution(parsed);
  }
}

class AthenaQuery extends Execution {
  constructor(sql, data = {}) {
    super(data);
    this.sql = sql || data.sql;
  }

  start() {}

  check() {}

  serialize() {
    const superClassData = JSON.parse(super.serialize());
    return JSON.stringify({ ...superClassData, sql: this.sql });
  }

  /**
   * @param {string} serializedAthenaQuery -
   * @returns {AthenaQuery} -
   */
  static deserialize(serializedAthenaQuery) {
    const parsed = JSON.parse(serializedAthenaQuery);
    return new AthenaQuery(parsed.sql, parsed);
  }
}

class Op {
  constructor(value) {
    this.value = value;
  }

  method() {
    return `Value is ${this.value}`;
  }
}

/**
 *
 * @param fn
 */
function op(fn) {
  const name = fn.name;
  const instance = new Op(fn);

  /**
   *
   */
  function callableFunction() {
    console.log(`Function ${name} is called with arguments:`, arguments);
    // Chek Op status
    const result = fn.apply(instance.method, arguments);
    // Mark Op record as completed
    // Enqueue next Ops
    console.log('Function returned:', result);
    return result;
  }
  // Copy methods and properties from the instance to the callable function
  Object.assign(callableFunction, instance);
  return callableFunction;
}

class Graph {
  constructor(fn, name) {
    this.fn = fn;
    this.graph_name = name;
  }

  test() {
    return this.graph_name;
  }
}
/**
 *
 * @param fn
 */
function graph(fn) {
  const name = fn.name;
  const instance = new Graph(fn, name);

  /**
   *
   */
  function callableFunction() {
    console.log(`Function ${name} is called with arguments:`, arguments);
    // Chek Op status
    const result = fn.apply(instance.method, arguments);
    // Mark Op record as completed
    // Enqueue next Ops
    console.log('Function returned:', result);
    return result;
  }
  // Copy methods and properties from the instance to the callable function
  Object.assign(callableFunction, instance);
  Object.getOwnPropertyNames(Graph.prototype).forEach((prop) => {
    console.log(prop);
    if (prop !== 'constructor') {
      Object.defineProperty(callableFunction, prop, {
        value: (...args) => instance[prop](...args),
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
  });
  return callableFunction;
}

const t1 = op(function t1() {
  return 1 + 1;
});

const t2 = op(function t2(t) {
  return t + 1;
});

const g = graph(function graph() {
  return t2(t1());
});

g();
console.log(g.test());
console.log(g);

console.timeEnd('Benchmark');
