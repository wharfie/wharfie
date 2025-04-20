const addon = require('./dist');

const sql = 'select * from test_db.table_name_raw';

console.log(addon.sum(2, 3));
console.log(addon.parse(sql));
