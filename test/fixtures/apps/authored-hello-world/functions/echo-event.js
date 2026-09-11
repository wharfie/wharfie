/**
 * Smallest possible portable activity demo.
 *
 * @param {{ who?: string, message?: string }} [input] - Activity input.
 * @param {{ caller: { metadata: { requestId?: string } } }} [runtime] - Wharfie-owned activity runtime.
 * @returns {{ ok: true, who: string, message: string, requestId: string | null }} - Normalized result.
 */
export function echoEvent(input = {}, runtime = { caller: { metadata: {} } }) {
  const who = input.who || 'world';
  return {
    ok: true,
    who,
    message: input.message || `hello ${who}`,
    requestId: runtime.caller.metadata.requestId || null,
  };
}
