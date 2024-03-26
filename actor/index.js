const ActorSystem = require('./actor-system');
const Actor = require('./actor');

// Define a custom actor by extending the base Actor class.
class GreeterActor extends Actor {
  receive(message) {
    if (message.type === 'greet') {
      console.log(`Hello, ${message.name}!`);
    } else {
      super.receive(message); // Fallback to default behavior for unrecognized messages.
    }
  }
}

/**
 *
 */
async function main() {
  // Create an instance of the ActorSystem and some actors.
  const system = new ActorSystem();
  system.createActor('greeter', GreeterActor);
  await system.provision();
}
main();
