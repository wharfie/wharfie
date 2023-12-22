console.time('Benchmark');
const { createId } = require('./lambdas/lib/id');

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
    // try {
    //   await this.fn(...args);
    // } catch (err) {
    //   // retry
    //   await this.retry(...args);
    //   throw err;
    // }
  }
}

class Graph extends Function {
  constructor(fn, options = {}) {
    super();
    this.fn = fn;
    this.options = options;
    this.id = options.id || createId();
    this.graph_name = fn.name || options.name || this.id;
    this.entrypoints = new Set();
    return new Proxy(this, {
      apply: (target, thisArg, args) => target._call(...args),
    });
  }

  _call(...args) {
    this.entrypoints.add(...args.filter((arg) => arg instanceof Op));
    // return this.fn(...args);
  }
}

const t1 = new Op(function t1() {
  return 1;
});

const t2 = new Op(function t2(t) {
  return t + 1;
});

const g = new Graph(function graph() {
  return t2(t1());
});

console.log(g());

console.log(g);

console.timeEnd('Benchmark');
