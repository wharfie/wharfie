import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const handler = async (
  timestamp,
  date,
  tinyint,
  smallint,
  real,
  double,
  decimal,
  bigint,
  integer,
  varchar,
  varbinary,
  boolean,
) => {
  return `timestamp: ${timestamp}, date: ${date}, tinyint: ${tinyint}, smallint: ${smallint}, real: ${real}, double: ${double}, decimal: ${decimal}, bigint: ${bigint}, integer: ${integer}, varchar: ${varchar}, varbinary: ${varbinary}, boolean: ${boolean}`;
};
module.exports = { handler };
