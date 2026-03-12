/**
 * Function demo that reports what arrived in `context`.
 *
 * This is handy for showing how `ActorSystem.createContext()` merges the
 * system-owned resources with caller-provided overrides.
 *
 * @param {unknown} [_event] - Event payload.
 * @param {{ requestId?: string, resources?: Record<string, any> }} [context] - Invocation context.
 * @returns {{ requestId: string | null, resourceKeys: string[], dbPresent: boolean, queueAdapter: string | null, extraNote: string | null }} - Result.
 */
export function inspectContext(_event, context = {}) {
  const resources = context.resources || {};
  const resourceKeys = Object.keys(resources).sort();

  return {
    requestId: context.requestId || null,
    resourceKeys,
    dbPresent: Boolean(resources.db),
    queueAdapter:
      typeof resources.queue?.adapter === 'string'
        ? resources.queue.adapter
        : null,
    extraNote:
      typeof resources.extra?.note === 'string' ? resources.extra.note : null,
  };
}
