// // smoke.js
// 'use strict';

// const duckdb = require('@duckdb/node-api');
// const { DuckDBInstance } = duckdb;

// const toSmallNumber = (v) =>
//   typeof v === 'bigint' ? Number(v) : v; // safe for small smoke-test values

// (async () => {
//   try {
//     console.log('DuckDB version:', duckdb.version());

//     const instance = await DuckDBInstance.create(':memory:');
//     const conn = await instance.connect();

//     // 1) trivial query sanity
//     {
//       const [row] = (await conn.runAndReadAll(
//         "select 1 as one, 2+2 as two, 'ok'::varchar as status"
//       )).getRowObjects();
//       if (row.one !== 1 || row.two !== 4 || row.status !== 'ok') {
//         throw new Error('basic SELECT sanity check failed');
//       }
//     }

//     // 2) DDL/DML + COUNT(*)
//     {
//       await conn.run('create table t(i int, s varchar)');
//       await conn.run("insert into t values (1,'a'),(2,'b'),(3,'c')");
//       const [row] = (await conn.runAndReadAll(
//         'select count(*) as cnt from t'
//       )).getRowObjects();
//       const cnt = toSmallNumber(row.cnt); // handles 3n vs 3
//       if (cnt !== 3) throw new Error('table row count mismatch');
//     }

//     // 3) range() + SUM(...)
//     {
//       // Option A: cast in SQL so JS sees a number
//       const [row] = (await conn.runAndReadAll(
//         'from range(5) select cast(sum(range) as int) as s'
//       )).getRowObjects();
//       if (row.s !== 10) throw new Error('range(5) sum mismatch');
//     }

//     conn.closeSync();
//     instance.closeSync();
//     console.log('✅ DuckDB smoke test passed');
//     process.exitCode = 0;
//   } catch (err) {
//     console.error('❌ DuckDB smoke test failed:', err);
//     process.exitCode = 1;
//   }
// })();
