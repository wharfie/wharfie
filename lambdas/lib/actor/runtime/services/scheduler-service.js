/**
 * Scheduler Service (Cron)
 *
 * - 5-field cron format: "min hour dom month dow".
 * - Cron evaluation is in UTC.
 * - Misfires are skipped by default (no catch-up/backfill).
 */

/**
 * @typedef SchedulerTrigger
 * @property {string} actor - Actor name/id to invoke.
 * @property {string} cron - 5-field cron expression.
 */

/**
 * @typedef SchedulerServiceOptions
 * @property {SchedulerTrigger[]} triggers - Trigger definitions.
 * @property {(actor: string, payload: any) => Promise<void>} invoke - Invoke hook.
 * @property {'all'|'leader'|'worker'} [role] - Node role.
 * @property {(msg: string, extra?: any) => void} [log] - Optional logger.
 */

/**
 * @typedef ParsedField
 * @property {Set<number>} values - Allowed values.
 * @property {number[]} sorted - Sorted values.
 * @property {boolean} isStar - True if wildcard.
 */

/**
 * @typedef ParsedCron
 * @property {ParsedField} minute -
 * @property {ParsedField} hour -
 * @property {ParsedField} dom -
 * @property {ParsedField} month -
 * @property {ParsedField} dow -
 */

/**
 * Parse a 5-field cron expression.
 *
 * Supported per-field tokens:
 * - *
 * - *\/n
 * - a
 * - a,b,c
 * - a-b
 * - a-b/n
 * @param {string} cron - cron.
 * @returns {ParsedCron} - Parsed.
 */
function parseCron(cron) {
  if (!cron || typeof cron !== 'string') {
    throw new TypeError('scheduler-service: cron must be a string');
  }

  const parts = cron.trim().split(/\s+/g);
  if (parts.length !== 5) {
    throw new Error(
      `scheduler-service: invalid cron (expected 5 fields): ${cron}`,
    );
  }

  return {
    minute: parseField(parts[0], 0, 59, 'minute'),
    hour: parseField(parts[1], 0, 23, 'hour'),
    dom: parseField(parts[2], 1, 31, 'day-of-month'),
    month: parseField(parts[3], 1, 12, 'month'),
    dow: parseDowField(parts[4]),
  };
}

/**
 * @param {string} raw - raw.
 * @returns {ParsedField} - Parsed.
 */
function parseDowField(raw) {
  const f = parseField(raw, 0, 7, 'day-of-week');

  // Normalize Sunday: allow 0 or 7.
  if (f.values.has(7)) {
    f.values.delete(7);
    f.values.add(0);
  }
  f.sorted = Array.from(f.values).sort((a, b) => a - b);
  return f;
}

/**
 * @param {string} raw - raw.
 * @param {number} min - min.
 * @param {number} max - max.
 * @param {string} label - label.
 * @returns {ParsedField} - Parsed.
 */
function parseField(raw, min, max, label) {
  const s = String(raw || '').trim();
  if (!s) throw new Error(`scheduler-service: empty cron field (${label})`);

  /** @type {Set<number>} */
  const values = new Set();
  let isStar = false;

  if (s === '*') {
    isStar = true;
    for (let i = min; i <= max; i++) values.add(i);
    return { values, sorted: rangeToSorted(values), isStar };
  }

  const chunks = s.split(',');
  for (const chunk of chunks) {
    const c = chunk.trim();
    if (!c) continue;

    if (c === '*') {
      isStar = true;
      for (let i = min; i <= max; i++) values.add(i);
      continue;
    }

    // */n
    if (c.startsWith('*/')) {
      const step = parseIntStrict(c.slice(2), label);
      if (step <= 0) {
        throw new Error(
          `scheduler-service: invalid step '${c}' (${label} must be > 0)`,
        );
      }
      for (let i = min; i <= max; i += step) values.add(i);
      continue;
    }

    // a-b[/n]
    const rangeMatch = /^(-?\d+)-(-?\d+)(?:\/(\d+))?$/.exec(c);
    if (rangeMatch) {
      const from = parseIntStrict(rangeMatch[1], label);
      const to = parseIntStrict(rangeMatch[2], label);
      const step = rangeMatch[3] ? parseIntStrict(rangeMatch[3], label) : 1;
      if (step <= 0) {
        throw new Error(
          `scheduler-service: invalid step '${c}' (${label} must be > 0)`,
        );
      }

      if (from < min || from > max || to < min || to > max) {
        throw new Error(
          `scheduler-service: value out of range (${label} ${min}-${max}): ${c}`,
        );
      }

      const lo = Math.min(from, to);
      const hi = Math.max(from, to);

      for (let i = lo; i <= hi; i += step) values.add(i);
      continue;
    }

    // a
    const v = parseIntStrict(c, label);
    if (v < min || v > max) {
      throw new Error(
        `scheduler-service: value out of range (${label} ${min}-${max}): ${v}`,
      );
    }
    values.add(v);
  }

  if (!values.size) {
    throw new Error(
      `scheduler-service: no values produced for cron field (${label}): ${raw}`,
    );
  }

  return { values, sorted: rangeToSorted(values), isStar };
}

/**
 * @param {Set<number>} set - set.
 * @returns {number[]} - Sorted.
 */
function rangeToSorted(set) {
  return Array.from(set).sort((a, b) => a - b);
}

/**
 * @param {string} s - s.
 * @param {string} label - label.
 * @returns {number} - Result.
 */
function parseIntStrict(s, label) {
  const str = String(s).trim();
  if (!/^-?\d+$/.test(str)) {
    throw new Error(`scheduler-service: invalid number '${s}' (${label})`);
  }
  const v = Number.parseInt(str, 10);
  if (!Number.isFinite(v)) {
    throw new Error(`scheduler-service: invalid number '${s}' (${label})`);
  }
  return v;
}

/**
 * Compute the next matching UTC time after `afterMs`.
 * @param {number} afterMs - Epoch millis.
 * @param {ParsedCron} cron - Parsed cron.
 * @returns {Date} - Next time (UTC).
 */
function nextUtc(afterMs, cron) {
  // cron granularity is minute; anchor to next minute boundary.
  const after = new Date(afterMs);
  let candidate = new Date(
    Date.UTC(
      after.getUTCFullYear(),
      after.getUTCMonth(),
      after.getUTCDate(),
      after.getUTCHours(),
      after.getUTCMinutes(),
      0,
      0,
    ),
  );

  if (candidate.getTime() <= afterMs) {
    candidate = new Date(candidate.getTime() + 60_000);
  }

  // Safety guard: search up to ~2 years worth of minutes.
  const maxSteps = 60 * 24 * 366 * 2;
  for (let steps = 0; steps < maxSteps; steps++) {
    if (matchesUtc(candidate, cron)) return candidate;
    candidate = new Date(candidate.getTime() + 60_000);
  }

  throw new Error('scheduler-service: failed to find next cron occurrence');
}

/**
 * Cron day semantics:
 * - If both DOM and DOW are '*', day matches.
 * - If one is '*', the other must match.
 * - If both are restricted, match if either matches (classic cron).
 * @param {Date} d - Date.
 * @param {ParsedCron} cron - cron.
 * @returns {boolean} - match.
 */
function matchesUtc(d, cron) {
  const minute = d.getUTCMinutes();
  const hour = d.getUTCHours();
  const dom = d.getUTCDate();
  const month = d.getUTCMonth() + 1;
  const dow = d.getUTCDay();

  if (!cron.minute.values.has(minute)) return false;
  if (!cron.hour.values.has(hour)) return false;
  if (!cron.month.values.has(month)) return false;

  const domMatch = cron.dom.values.has(dom);
  const dowMatch = cron.dow.values.has(dow);

  if (cron.dom.isStar && cron.dow.isStar) return true;
  if (cron.dom.isStar) return dowMatch;
  if (cron.dow.isStar) return domMatch;
  return domMatch || dowMatch;
}

/**
 * @typedef TriggerState
 * @property {string} actor -
 * @property {string} cron -
 * @property {ParsedCron} parsed -
 * @property {any|null} timer -
 */

export default class SchedulerService {
  /**
   * @param {SchedulerServiceOptions} options - options.
   */
  constructor(
    { triggers, invoke, role = 'all', log } = /** @type {any} */ ({}),
  ) {
    if (!Array.isArray(triggers)) {
      throw new TypeError('scheduler-service: triggers must be an array');
    }
    if (typeof invoke !== 'function') {
      throw new TypeError('scheduler-service: invoke must be a function');
    }
    this.invoke = invoke;
    this.role = role;
    this.log = log;

    /** @type {TriggerState[]} */
    this.triggers = triggers.map((t) => {
      if (!t || typeof t !== 'object') {
        throw new TypeError('scheduler-service: trigger must be an object');
      }
      const actor = /** @type {any} */ (t).actor;
      const cron = /** @type {any} */ (t).cron;
      if (!actor || typeof actor !== 'string') {
        throw new TypeError(
          'scheduler-service: trigger.actor must be a string',
        );
      }
      if (!cron || typeof cron !== 'string') {
        throw new TypeError('scheduler-service: trigger.cron must be a string');
      }
      return {
        actor,
        cron,
        parsed: parseCron(cron),
        timer: null,
      };
    });

    this._running = false;
  }

  /**
   * Start scheduling.
   */
  start() {
    if (this._running) return;
    this._running = true;

    // Convention: workers never run cron triggers.
    if (this.role === 'worker') {
      this.log && this.log('scheduler-service disabled (role=worker)');
      return;
    }

    const now = Date.now();
    for (const t of this.triggers) {
      this._scheduleNext(t, now);
    }
  }

  /**
   * Stop scheduling (best-effort). Does not await in-flight invocations.
   * @returns {Promise<void>} - Result.
   */
  async stop() {
    if (!this._running) return;
    this._running = false;
    for (const t of this.triggers) {
      if (t.timer) {
        clearTimeout(t.timer);
        t.timer = null;
      }
    }
  }

  /**
   * Alias for stop() to match other *-service conventions.
   * @returns {Promise<void>} - Result.
   */
  async close() {
    await this.stop();
  }

  /**
   * @param {TriggerState} t - trigger.
   * @param {number} afterMs - schedule after.
   */
  _scheduleNext(t, afterMs) {
    if (!this._running) return;

    let next;
    try {
      next = nextUtc(afterMs, t.parsed);
    } catch (err) {
      const msg =
        err && typeof err === 'object' && 'stack' in err
          ? // @ts-ignore
            String(err.stack)
          : String(err);
      this.log &&
        this.log('scheduler-service: cron parse/eval failed', {
          actor: t.actor,
          cron: t.cron,
          error: msg,
        });
      return;
    }

    const delayMs = Math.max(0, next.getTime() - Date.now());
    t.timer = setTimeout(() => {
      t.timer = null;
      this._onTick(t, next.getTime());
    }, delayMs);
  }

  /**
   * @param {TriggerState} t - trigger.
   * @param {number} scheduledMs - scheduled time.
   */
  _onTick(t, scheduledMs) {
    if (!this._running) return;

    const now = Date.now();

    // Skip misfires: if we're significantly late, do not attempt to catch up.
    // (Schedule the next run from *now*, not from the scheduled time.)
    const lateMs = now - scheduledMs;

    if (lateMs <= 5 * 60_000) {
      // Fire (best-effort; never throw out of the timer callback).
      Promise.resolve()
        .then(() =>
          this.invoke(t.actor, {
            cron: t.cron,
            scheduledTime: new Date(scheduledMs).toISOString(),
          }),
        )
        .catch((err) => {
          const msg =
            err && typeof err === 'object' && 'stack' in err
              ? // @ts-ignore
                String(err.stack)
              : String(err);
          this.log &&
            this.log('scheduler-service: invoke failed', {
              actor: t.actor,
              cron: t.cron,
              error: msg,
            });
        });
    } else {
      this.log &&
        this.log('scheduler-service: skipping misfire (late)', {
          actor: t.actor,
          cron: t.cron,
          scheduledTime: new Date(scheduledMs).toISOString(),
          now: new Date(now).toISOString(),
          lateMs,
        });
    }

    this._scheduleNext(t, now);
  }
}

/**
 * Convenience helper: start immediately (like other services).
 * @param {SchedulerServiceOptions} options - options.
 * @returns {Promise<SchedulerService>} - Result.
 */
export async function startSchedulerService(options) {
  const svc = new SchedulerService(options);
  svc.start();
  return svc;
}
