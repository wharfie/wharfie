const LocalDB = require('../lambdas/lib/db/sqllite');

// Initialize the root database
const db = LocalDB.init();

// Insert a key/value pair into the root database
db.put('greeting', { text: 'Hello, world!' });
console.log('Inserted greeting:', db.get('greeting'));

// Update the stored value by merging new properties
db.update('greeting', { language: 'English' });
console.log('Updated greeting:', db.get('greeting'));

// Create a namespaced sub-database for "user" data
const userDB = LocalDB.open('user');

// Insert key/value pairs in the namespaced database
userDB.put('user1', { name: 'Alice', age: 30 });
userDB.put('user2', { name: 'Bob', age: 25 });
console.log('Inserted users in namespaced DB.');

// Retrieve all keys that begin with 'user' in the namespaced DB
const users = userDB.getBeginsWith('user');
console.log('Namespaced users:', users);

// Delete a user entry
userDB.delete('user1');
console.log('After deletion, user1:', userDB.get('user1')); // Should be undefined

// Close the root database connection
db.close();
