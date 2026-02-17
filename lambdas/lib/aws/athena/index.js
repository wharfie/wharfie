/**
 * DEPRECATED PATH.
 *
 * Historically this project used AWS Athena directly. As part of the “no AWS managed services”
 * migration, `lambdas/lib/athena` is now just a compatibility shim that exports the DuckDB-backed
 * query engine.
 *
 * New code should import from `lambdas/lib/duckdb`.
 */
import DuckDBQueryEngine from '../../duckdb/index.js';

export default DuckDBQueryEngine;
