import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { createId } from '../id.js';
import QueryParser from '../athena/query-parser.js';
import ReferencesMetastore from '../metastore/references.js';

const require = createRequire(import.meta.url);
// @duckdb/node-api is CommonJS-only today; use require() under ESM.
/** @type {any} */
const duckdb = require('@duckdb/node-api');
const { DuckDBInstance } = duckdb;

/**
 * @typedef {Object} DuckDBQueryEngineOptions
 * @property {string} [databasePath] - DuckDB database path. Use ':memory:' for ephemeral DB.
 * @property {boolean} [enableS3] - If true, LOADs (and if needed INSTALLs) DuckDB's httpfs extension and configures S3 settings.
 * @property {DuckDBS3Config} [s3] - S3 configuration (optional). If omitted and enableS3=true, reads from standard AWS env vars.
 */

/**
 * @typedef {Object} DuckDBS3Config
 * @property {string} [region] - AWS region.
 * @property {string} [accessKeyId] - AWS access key id.
 * @property {string} [secretAccessKey] - AWS secret access key.
 * @property {string} [sessionToken] - AWS session token.
 * @property {string} [endpoint] - S3-compatible endpoint URL.
 * @property {boolean} [useSSL] - Whether to use SSL for the S3 endpoint.
 * @property {'path'|'vhost'} [urlStyle] - S3 URL style.
 */

/**
 * DuckDB-backed query runner.
 *
 * This is intentionally synchronous-from-the-caller POV: `startQueryExecution` runs the query
 * immediately and stores its results for later `getQueryResults` calls.
 *
 * Even though we no longer depend on AWS managed services, we keep a tiny "query execution id"
 * abstraction because other parts of the codebase are written around it.
 */
class DuckDBQueryEngine {
  /**
   * @param {DuckDBQueryEngineOptions} [options] - Engine options.
   */
  constructor(options = {}) {
    this.databasePath = options.databasePath || ':memory:';
    this.enableS3 = options.enableS3 || false;
    this.s3Config = options.s3;

    this.parser = new QueryParser();

    /** @type {Promise<any> | null} */
    this._instancePromise = null;
    /** @type {Promise<any> | null} */
    this._connectionPromise = null;

    /**
     * In-memory query execution store, keyed by QueryExecutionId.
     * @type {Map<string, { query: string, state: 'RUNNING'|'SUCCEEDED'|'FAILED', startedAt: number, endedAt?: number, rows?: Array<Record<string, any>>, error?: Error }>}
     */
    this._executions = new Map();
  }

  /**
   * Get or create a DuckDB connection.
   * @returns {Promise<any>} - DuckDB connection.
   */
  async _getConnection() {
    if (!this._connectionPromise) {
      const instancePromise = DuckDBInstance.create(this.databasePath);
      this._instancePromise = instancePromise;
      this._connectionPromise = instancePromise.then((/** @type {any} */ i) =>
        i.connect(),
      );
      if (this.enableS3) {
        // Best effort: configure S3 before the first query runs.
        const conn = await this._connectionPromise;
        await this._configureS3(conn, this.s3Config);
      }
    }
    return this._connectionPromise;
  }

  /**
   * Configure DuckDB for s3:// reads/writes (httpfs extension).
   * @param {any} conn - DuckDB connection.
   * @param {DuckDBS3Config | undefined} cfg - S3 configuration.
   * @returns {Promise<void>} - Resolves when configuration is applied.
   */
  async _configureS3(conn, cfg) {
    const region =
      cfg?.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
    const accessKeyId = cfg?.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      cfg?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = cfg?.sessionToken || process.env.AWS_SESSION_TOKEN;
    const endpoint = cfg?.endpoint || process.env.S3_ENDPOINT;
    const useSSL = typeof cfg?.useSSL === 'boolean' ? cfg.useSSL : undefined;
    const urlStyle = cfg?.urlStyle;

    // Nothing to do.
    if (
      !region &&
      !accessKeyId &&
      !secretAccessKey &&
      !sessionToken &&
      !endpoint &&
      typeof useSSL !== 'boolean' &&
      !urlStyle
    ) {
      return;
    }

    // Load httpfs (needed for s3:// reads/writes).
    try {
      await conn.run('LOAD httpfs;');
    } catch (e1) {
      // Some distributions require INSTALL first.
      try {
        await conn.run('INSTALL httpfs;');
        await conn.run('LOAD httpfs;');
      } catch (e2) {
        throw new Error(
          `DuckDB httpfs extension unavailable. If you need s3:// access, ensure DuckDB can LOAD httpfs (or can INSTALL it at runtime). Original error: ${String(
            e2,
          )}`,
        );
      }
    }

    /** @type {string[]} */
    const settings = [];
    if (region)
      settings.push(
        `SET s3_region='${DuckDBQueryEngine._escapeSqlString(region)}';`,
      );
    if (accessKeyId)
      settings.push(
        `SET s3_access_key_id='${DuckDBQueryEngine._escapeSqlString(accessKeyId)}';`,
      );
    if (secretAccessKey)
      settings.push(
        `SET s3_secret_access_key='${DuckDBQueryEngine._escapeSqlString(secretAccessKey)}';`,
      );
    if (sessionToken)
      settings.push(
        `SET s3_session_token='${DuckDBQueryEngine._escapeSqlString(sessionToken)}';`,
      );
    if (endpoint)
      settings.push(
        `SET s3_endpoint='${DuckDBQueryEngine._escapeSqlString(endpoint)}';`,
      );
    if (typeof useSSL === 'boolean')
      settings.push(`SET s3_use_ssl=${useSSL ? 'true' : 'false'};`);
    if (urlStyle)
      settings.push(
        `SET s3_url_style='${DuckDBQueryEngine._escapeSqlString(urlStyle)}';`,
      );

    for (const stmt of settings) {
      await conn.run(stmt);
    }
  }

  /**
   * Escape a SQL single-quoted string literal.
   * @param {string} value - Raw value.
   * @returns {string} - Escaped value.
   */
  static _escapeSqlString(value) {
    return String(value).replace(/'/g, "''");
  }

  /**
   * Escape a SQL identifier for double-quoting.
   * @param {string} ident - Raw identifier.
   * @returns {string} - Escaped identifier.
   */
  static _escapeIdent(ident) {
    return String(ident).replace(/"/g, '""');
  }

  /**
   * Convert DuckDB row objects to JSON-friendly output.
   * @param {Record<string, any>} row - Row object.
   * @returns {Record<string, any>} - Normalized row object.
   */
  static _normalizeRow(row) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, v] of Object.entries(row)) {
      // DuckDB frequently returns BIGINT as JS BigInt.
      if (typeof v === 'bigint') out[k] = Number(v);
      else out[k] = v;
    }
    return out;
  }

  /**
   * Determine whether a URI points to a remote object store.
   * @param {string} uri - Output URI.
   * @returns {boolean} - True if the URI is remote (s3/http/https).
   */
  static _isRemoteUri(uri) {
    const s = String(uri || '');
    return (
      s.startsWith('s3://') ||
      s.startsWith('http://') ||
      s.startsWith('https://')
    );
  }

  /**
   * Normalize an output URI for DuckDB COPY.
   *
   * DuckDB COPY works best with plain local filesystem paths. If the caller provides a file:// URI
   * we convert it to a local path for both directory creation and the DuckDB COPY target.
   * @param {string} outputUri - Destination path/URI.
   * @returns {string} - Normalized destination (local path or remote URI).
   */
  static _normalizeOutputUri(outputUri) {
    const raw = String(outputUri || '');
    const out = raw.endsWith('/') ? raw : `${raw}/`;
    if (out.startsWith('file://')) {
      return fileURLToPath(out);
    }
    return out;
  }

  /**
   * Parse SQL in user-land and extract referenced sources/columns.
   * @param {string} query - SQL text.
   * @returns {{sources: Array<{DatabaseName: string, TableName: string}>, columns: string[], selectAsColumns: Record<string, string[]>}} - Parsed refs.
   */
  extractSources(query) {
    return this.parser.extractSources(query);
  }

  /**
   * Run a statement without reading results.
   * @param {string} sql - SQL statement.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async run(sql) {
    const conn = await this._getConnection();
    await conn.run(sql);
  }

  /**
   * Run a query and return all rows as objects.
   * @param {string} sql - SQL query.
   * @returns {Promise<Array<Record<string, any>>>} - Rows.
   */
  async all(sql) {
    const conn = await this._getConnection();
    const result = await conn.runAndReadAll(sql);
    // DuckDBResult#getRowObjects returns array of row objects.
    const rows = result.getRowObjects();
    return rows.map(DuckDBQueryEngine._normalizeRow);
  }

  /**
   * Create/overwrite a DuckDB view for a logical table backed by parquet files.
   * @param {Object} params - Parameters.
   * @param {string} params.schema - DuckDB schema name (usually your logical database name).
   * @param {string} params.table - View name.
   * @param {string[]} params.files - List of parquet file URIs/paths.
   * @param {boolean} [params.hivePartitioning] - Enable hive partition parsing from key=value directory names.
   * @returns {Promise<void>} - Resolves when the view is registered.
   */
  async registerParquetView({ schema, table, files, hivePartitioning = true }) {
    const conn = await this._getConnection();

    const schemaIdent = DuckDBQueryEngine._escapeIdent(schema);
    const tableIdent = DuckDBQueryEngine._escapeIdent(table);

    await conn.run(`CREATE SCHEMA IF NOT EXISTS "${schemaIdent}";`);

    if (!files || files.length === 0) {
      // No files -> empty view (caller can overwrite later).
      await conn.run(
        `CREATE OR REPLACE VIEW "${schemaIdent}"."${tableIdent}" AS SELECT NULL::INTEGER AS __empty WHERE FALSE;`,
      );
      return;
    }

    const fileListSql = `[${files
      .map((f) => `'${DuckDBQueryEngine._escapeSqlString(f)}'`)
      .join(',')}]`;
    const sql = `CREATE OR REPLACE VIEW "${schemaIdent}"."${tableIdent}" AS
      SELECT *
      FROM read_parquet(${fileListSql}, hive_partitioning=${
        hivePartitioning ? 'true' : 'false'
      }, union_by_name=true);`;
    await conn.run(sql);
  }

  /**
   * Create/overwrite a DuckDB view backed by the current state of a references metastore.
   * @param {Object} params - Parameters.
   * @param {string} params.schema - DuckDB schema name.
   * @param {string} params.table - View name.
   * @param {string} params.referencesUri - Root references location (directory containing `files` manifests).
   * @param {string[]} [params.partitionKeys] - Partition keys (in order) if the table is partitioned.
   * @returns {Promise<void>} - Resolves when the view is registered.
   */
  async registerTableFromReferences({
    schema,
    table,
    referencesUri,
    partitionKeys = [],
  }) {
    const metastore = new ReferencesMetastore({ referencesUri, partitionKeys });
    const files = await metastore.getAllReferencedFiles();
    await this.registerParquetView({
      schema,
      table,
      files,
      hivePartitioning: partitionKeys.length > 0,
    });
  }

  /**
   * Write the result of a SELECT to partitioned parquet output (DuckDB COPY).
   * @param {Object} params - Parameters.
   * @param {string} params.selectSql - A SELECT statement (without the surrounding COPY()).
   * @param {string} params.outputUri - Destination directory (local path, file://..., or s3://...).
   * @param {string[]} [params.partitionBy] - Partition column names.
   * @returns {Promise<void>} - Resolves when the parquet files are written.
   */
  async copyToParquet({ selectSql, outputUri, partitionBy = [] }) {
    const conn = await this._getConnection();

    const out = DuckDBQueryEngine._normalizeOutputUri(outputUri);

    // DuckDB does not reliably create nested directories for local filesystem targets. Ensure the
    // directory exists before COPY, but only for local paths.
    if (!DuckDBQueryEngine._isRemoteUri(out)) {
      await mkdir(out, { recursive: true });
    }

    const partitionClause =
      partitionBy.length > 0
        ? `, PARTITION_BY (${partitionBy
            .map((k) => `"${DuckDBQueryEngine._escapeIdent(k)}"`)
            .join(', ')})`
        : '';

    // NOTE: DuckDB COPY options are case-insensitive. We keep them uppercase for readability.
    const sql = `COPY (${selectSql}) TO '${DuckDBQueryEngine._escapeSqlString(
      out,
    )}' (FORMAT PARQUET${partitionClause});`;
    await conn.run(sql);
  }

  /**
   * Execute immediately and store results in-memory by QueryExecutionId.
   * @param {{QueryString: string}} params - Query parameters.
   * @returns {Promise<{QueryExecutionId: string}>} - Query execution id.
   */
  async startQueryExecution(params) {
    const queryExecutionId = createId();
    const query = params.QueryString || '';

    this._executions.set(queryExecutionId, {
      query,
      state: 'RUNNING',
      startedAt: Date.now(),
    });

    try {
      const rows = await this.all(query);
      const ex = this._executions.get(queryExecutionId);
      if (ex) {
        ex.state = 'SUCCEEDED';
        ex.endedAt = Date.now();
        ex.rows = rows;
      }
    } catch (e) {
      const ex = this._executions.get(queryExecutionId);
      if (ex) {
        ex.state = 'FAILED';
        ex.endedAt = Date.now();
        ex.error = /** @type {Error} */ (e);
      }
    }

    return { QueryExecutionId: queryExecutionId };
  }

  /**
   * Read query execution status and query text.
   * @param {{QueryExecutionId: string}} params - Query execution id wrapper.
   * @returns {Promise<{QueryExecution: { QueryExecutionId: string, Query: string, Status: { State: string, StateChangeReason?: string }}}>} - Execution details.
   */
  async getQueryExecution(params) {
    const ex = this._executions.get(params.QueryExecutionId);
    if (!ex) {
      return {
        QueryExecution: {
          QueryExecutionId: params.QueryExecutionId,
          Query: '',
          Status: {
            State: 'FAILED',
            StateChangeReason: 'Unknown QueryExecutionId',
          },
        },
      };
    }
    return {
      QueryExecution: {
        QueryExecutionId: params.QueryExecutionId,
        Query: ex.query,
        Status: {
          State: ex.state,
          ...(ex.error
            ? { StateChangeReason: ex.error.message || String(ex.error) }
            : {}),
        },
      },
    };
  }

  /**
   * Read query results (only available for succeeded executions).
   * @param {{QueryExecutionId: string}} params - Query execution id wrapper.
   * @returns {Promise<Array<Record<string, any>>>} - Result rows.
   */
  async getQueryResults(params) {
    const ex = this._executions.get(params.QueryExecutionId);
    if (!ex) return [];
    if (ex.state !== 'SUCCEEDED') return [];
    return ex.rows || [];
  }

  /**
   * Close DuckDB resources.
   * @returns {Promise<void>} - Resolves once closed.
   */
  async close() {
    try {
      const conn = await this._connectionPromise;
      if (conn && conn.close) await conn.close();
    } catch (e) {
      // ignore
    }
    try {
      const inst = await this._instancePromise;
      if (inst && inst.close) await inst.close();
    } catch (e) {
      // ignore
    }
    this._connectionPromise = null;
    this._instancePromise = null;
  }
}

export default DuckDBQueryEngine;
