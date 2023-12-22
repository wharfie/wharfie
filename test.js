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

  retry() {}

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

class Op extends Function {
  constructor(fn, options = {}) {
    super();
    this.fn = fn;
    this.options = options;
    this.id = options.id || createId();
    this.graph_name = fn.name || options.name || this.id;
    return new Proxy(this, {
      apply: (target, thisArg, args) => target._call(...args),
    });
  }

  async _call(...args) {
    try {
      await this.fn(...args);
    } catch (err) {
      // retry
      await this.retry(...args);
      throw err;
    }
  }
}

class Graph extends Function {
  constructor(fn, options = {}) {
    super();
    this.fn = fn;
    this.options = options;
    this.id = options.id || createId();
    this.graph_name = fn.name || options.name || this.id;
    return new Proxy(this, {
      apply: (target, thisArg, args) => target._call(...args),
    });
  }

  _call(...args) {
    return this.fn(...args);
  }
}

const t1 = new Op(function t1() {
  return 1;
});

const t2 = new Op(function t2(t) {
  return t + 1;
});

const err = new Op(function err() {
  throw new Error('test');
});

const g = new Graph(function graph() {
  return t2(t1());
});

// const t1 = function t1() {
//   return 1;
// };

// const t2 = function t2(t) {
//   //   throw new Error('test');
//   return t + 1;
// };

// const g = function graph() {
//   return t2(t1());
// };

// console.log(g);
console.log(g());

console.timeEnd('Benchmark');
