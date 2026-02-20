import { describe, expect, it } from '@jest/globals';

import QueryParser from '../../lambdas/lib/athena/query-parser.js';

describe('QueryParser (postgresql dialect)', () => {
  it('extracts table sources (schema-qualified) and column lineage', () => {
    const qp = new QueryParser();

    const sql = `
      SELECT
        t.col1,
        t.col2 AS renamed,
        (t.col3 + t.col4) AS sum_col
      FROM my_schema.my_table AS t
      WHERE t.col1 > 10
    `;

    const { sources, columns, selectAsColumns } = qp.extractSources(sql);

    expect(sources).toEqual([
      { DatabaseName: 'my_schema', TableName: 'my_table' },
    ]);

    // node-sql-parser may include additional columns (ex: from WHERE); we assert the core ones.
    expect(columns).toEqual(
      expect.arrayContaining(['col1', 'col2', 'col3', 'col4']),
    );

    // Lineage for aliased select expressions.
    expect(selectAsColumns.renamed.sort()).toEqual(['col2']);
    expect(selectAsColumns.sum_col.sort()).toEqual(['col3', 'col4']);
  });

  it('extracts multiple sources from joins (mixed qualification)', () => {
    const qp = new QueryParser();

    const sql = `
      SELECT a.id, b.name
      FROM sch.table_a a
      JOIN table_b b
        ON a.id = b.id
    `;

    const { sources, columns } = qp.extractSources(sql);

    expect(sources).toEqual(
      expect.arrayContaining([
        { DatabaseName: 'sch', TableName: 'table_a' },
        { DatabaseName: '', TableName: 'table_b' },
      ]),
    );

    expect(columns).toEqual(expect.arrayContaining(['id', 'name']));
  });
});
