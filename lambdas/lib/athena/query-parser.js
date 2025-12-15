/* eslint-disable new-cap */
'use strict';
import { Parser } from 'node-sql-parser/build/athena.js';

class QueryParser {
  constructor() {
    this.parser = new Parser();
  }

  /**
   * @param {import('node-sql-parser/build/athena.js').ExpressionValue} node -
   * @param {string[]} results -
   * @returns {string[]} -
   */
  traverseExpressionAst(node, results = []) {
    if (Array.isArray(node)) {
      for (const item of node) {
        this.traverseExpressionAst(item, results);
      }
    } else if (typeof node === 'object' && node !== null) {
      if (node.type === 'column_ref' && 'column' in node) {
        if (typeof node.column === 'string') {
          results.push(node.column);
        }
      }
      for (const value of Object.values(node)) {
        this.traverseExpressionAst(value, results);
      }
    }
    return results;
  }

  /**
   * @param {import('node-sql-parser/build/athena.js').Column} ast -
   * @returns {ColumnSelection} -
   */
  traverseColumnAst(ast) {
    const columns = new Set();
    this.traverseExpressionAst(ast.expr).forEach((column) => {
      columns.add(column);
    });
    const identifier = typeof ast.as === 'string' ? ast.as : '';
    return {
      columns,
      identifier,
    };
  }

  /**
   * @param {import('node-sql-parser/build/athena.js').Column[]} ast -
   * @returns {ColumnSelection[]} -
   */
  traverseAst(ast) {
    return ast.map((item) => this.traverseColumnAst(item));
  }

  /**
   * @typedef ColumnSelection
   * @property {string} identifier -
   * @property {Set<string>} columns -
   */

  /**
   * @typedef ExtractSourcesReturn
   * @property {Array<{DatabaseName: string, TableName: string}>} sources -
   * @property {Array<string>} columns -
   * @property {Array<ColumnSelection>} selectAsColumns -
   */

  /**
   * @param {string} query - query to evaluate
   * @returns {ExtractSourcesReturn} -
   */
  extractSources(query) {
    const output = this.parser.parse(query);
    const sources = output.tableList.map((tableref) => {
      const parts = tableref.split('::');
      return {
        DatabaseName: parts[1] === 'null' ? '' : parts[1],
        TableName: parts[2],
      };
    });
    const columns = output.columnList.map((columnRef) => {
      const parts = columnRef.split('::');
      return parts[2];
    });
    if (output.ast instanceof Array || output.ast.type !== 'select') {
      throw new Error('Unsupported query');
    }
    const selectAsColumns = this.traverseAst(output.ast.columns);

    return {
      sources,
      columns,
      selectAsColumns,
    };
  }
}

export default QueryParser;
