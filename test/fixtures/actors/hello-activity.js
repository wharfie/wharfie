/**
 * Neutral activity fixture used by ActorSystem build-graph tests.
 *
 * @param {{who?: string}} input - Activity input.
 * @returns {{message: string}} - Greeting result.
 */
export function helloActivity(input = {}) {
  return { message: `hello ${input.who || 'world'}` };
}
