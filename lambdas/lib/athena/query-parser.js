import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
/** @type {any} */
const pgSqlParser = require('node-sql-parser/build/postgresql');

/**
 * SQL parser wrapper (PostgreSQL dialect).
 *
 * This module is used for:
 * - dependency discovery (tables referenced by a view/model)
 * - basic column reference discovery (for partition propagation)
 * - select-alias lineage tracking (which selected aliases depend on which source columns)
 *
 * Parsing stays in user-land by design. DuckDB is the execution engine; we do not depend on
 * DuckDB's internal parser/AST.
 */
class QueryParser {
  constructor() {
    /** @type {any} */
    this.parser = new pgSqlParser.Parser();
  }

  /**
   * Normalize a node-sql-parser reference token.
   *
   * node-sql-parser sometimes emits the literal string "null" for missing schema/table segments.
   *
   * @param {unknown} token - Raw token.
   * @returns {string} - Normalized token (empty string if missing).
   */
  static normalizeToken(token) {
    const s = String(token ?? '');
    if (s === 'null' || s === 'undefined') return '';
    return s;
  }

  /**
   * Split a node-sql-parser reference string.
   *
   * node-sql-parser encodes refs like:
   * - `<statement>::<schema>::<table>`
   * - `<statement>::<table>`
   * - `<statement>::<schema>::<table>::<column>`
   *
   * @param {string} ref - Reference string produced by node-sql-parser.
   * @returns {{ statement: string, parts: string[] }} - Statement name and the remaining parts.
   */
  static splitRef(ref) {
    const raw = String(ref || '');
    const parts = raw.split('::');
    const statement = parts[0] || '';
    return { statement, parts: parts.slice(1) };
  }

  /**
   * Extract referenced sources and columns from a SQL query.
   *
   * @param {string} query - SQL query text.
   * @returns {{
   *  sources: Array<{DatabaseName: string, TableName: string}>,
   *  columns: string[],
   *  selectAsColumns: Record<string, string[]>
   * }} - Parsed sources/columns/alias lineage.
   */
  extractSources(query) {
    if (!query || typeof query !== 'string') {
      throw new Error('query must be a string');
    }

    /** @type {any} */
    const output = this.parser.parse(query);

    /**
     * node-sql-parser tableList format is typically:
     *   <statement>::<schema>::<table>
     * or
     *   <statement>::<table>
     *
     * Treat the last token as table and the previous as schema/db (if present).
     */
    const tableList = /** @type {string[]} */ (output.tableList || []);

    /** @type {Map<string, {DatabaseName: string, TableName: string}>} */
    const sourcesByKey = new Map();
    for (const tableRef of tableList) {
      const { parts } = QueryParser.splitRef(tableRef);
      const rawTable = parts.length ? parts[parts.length - 1] : '';
      const rawDb = parts.length >= 2 ? parts[parts.length - 2] : '';
      const table = QueryParser.normalizeToken(rawTable);
      const db = QueryParser.normalizeToken(rawDb);

      if (!table) continue;
      const key = `${db}.${table}`;
      if (!sourcesByKey.has(key)) {
        sourcesByKey.set(key, { DatabaseName: db, TableName: table });
      }
    }

    const sources = Array.from(sourcesByKey.values());

    const columnList = /** @type {string[]} */ (output.columnList || []);
    const columns = Array.from(
      new Set(
        columnList
          .map((colRef) => {
            const { parts } = QueryParser.splitRef(colRef);
            const rawCol = parts.length ? parts[parts.length - 1] : '';
            return QueryParser.normalizeToken(rawCol);
          })
          .filter(Boolean),
      ),
    );

    /** @type {Record<string, string[]>} */
    const selectAsColumns = {};

    // output.ast can be a single statement or an array of statements.
    // We only care about SELECT expressions for column lineage.
    const astList = Array.isArray(output.ast) ? output.ast : [output.ast];
    for (const stmt of astList) {
      if (!stmt || typeof stmt !== 'object') continue;
      const cols = /** @type {any[]} */ (
        /** @type {any} */ (stmt).columns || []
      );
      for (const col of cols) {
        const as = /** @type {any} */ (col).as;
        if (!as) continue;
        const columnsInExpr = QueryParser.traverseExpressionAst(
          /** @type {any} */ (col).expr,
          new Set(),
        );
        selectAsColumns[as] = Array.from(columnsInExpr);
      }
    }

    return { sources, columns, selectAsColumns };
  }

  /**
   * Extract an identifier name from a node-sql-parser identifier node.
   *
   * The PostgreSQL dialect frequently represents identifiers as:
   *   { type: 'default', value: 'col_name' }
   *
   * Some shapes nest under an `expr` property.
   *
   * @param {unknown} ident - Identifier candidate.
   * @returns {string | null} - Identifier name (or null if not an identifier).
   */
  static extractIdentifierName(ident) {
    if (!ident) return null;
    if (typeof ident === 'string') return QueryParser.normalizeToken(ident);

    if (typeof ident !== 'object') return null;

    /** @type {any} */
    const obj = ident;

    // Common: { type: 'default', value: 'col2' }
    if (typeof obj.value === 'string')
      return QueryParser.normalizeToken(obj.value);

    // Sometimes: { expr: { type:'default', value:'col2' } }
    if (
      obj.expr &&
      typeof obj.expr === 'object' &&
      typeof obj.expr.value === 'string'
    ) {
      return QueryParser.normalizeToken(obj.expr.value);
    }

    // Some versions use { column: { type:'default', value:'col2' } }
    if (obj.column) return QueryParser.extractIdentifierName(obj.column);

    return null;
  }

  /**
   * Walk an expression AST and collect any referenced column names.
   *
   * @param {any} node - AST node to traverse.
   * @param {Set<string>} columns - Accumulator set for column names.
   * @returns {Set<string>} - The same accumulator set.
   */
  static traverseExpressionAst(node, columns) {
    if (!node || typeof node !== 'object') return columns;

    // node-sql-parser uses `column_ref` nodes for column references in expressions.
    if (node.type === 'column_ref') {
      const colName = QueryParser.extractIdentifierName(node.column);
      if (colName) columns.add(colName);
      return columns;
    }

    // Walk object children (generic).
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.forEach((child) =>
          QueryParser.traverseExpressionAst(child, columns),
        );
      } else if (value && typeof value === 'object') {
        QueryParser.traverseExpressionAst(value, columns);
      }
    }

    return columns;
  }
}

export default QueryParser;
