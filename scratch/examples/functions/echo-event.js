/**
 * Smallest possible Function API demo.
 *
 * @param {{ who?: string, message?: string }} [event] - Event payload.
 * @param {{ requestId?: string }} [context] - Invocation context.
 * @returns {{ ok: true, who: string, message: string, requestId: string | null }} - Normalized result.
 */
export function echoEvent(event = {}, context = {}) {
  const who = event.who || 'world';
  return {
    ok: true,
    who,
    message: event.message || `hello ${who}`,
    requestId: context.requestId || null,
  };
}
