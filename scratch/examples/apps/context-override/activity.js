/**
 * Report the stable context and merged resource overrides for this invocation.
 * @param {unknown} [_event] - Event payload.
 * @param {{ requestId?: string, resources?: Record<string, any> }} [context] - Invocation context.
 * @returns {{ requestId: string | null, resourceKeys: string[], dbPresent: boolean, queueAdapter: string | null, extraNote: string | null }} - Context summary.
 */
export function inspectContext(_event, context = {}) {
  const resources = context.resources || {};
  return {
    requestId: context.requestId || null,
    resourceKeys: Object.keys(resources).sort(),
    dbPresent: Boolean(resources.db),
    queueAdapter:
      typeof resources.queue?.adapter === 'string'
        ? resources.queue.adapter
        : null,
    extraNote:
      typeof resources.extra?.note === 'string' ? resources.extra.note : null,
  };
}
