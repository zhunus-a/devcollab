const fs = require('fs');
const path = require('path');
const db = require('./db');

(async () => {
  await db.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  console.log('Tables created');
  await db.pool.end();
})();
