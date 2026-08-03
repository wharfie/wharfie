/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  EXECUTION_LEDGER_RUN_OUTPUT_DISCLOSURE,
  EXECUTION_LEDGER_RUN_OUTPUT_KIND,
  EXECUTION_LEDGER_RUN_OUTPUT_SCHEMA_VERSION,
} from '../../src/core/lib/ledger/run-output.js';
import { createExecutionLedgerRunOutputCommand } from '../../src/core/runtime/operator/execution-ledger-run-output-command.js';
import { renderBoundedTerminalSafeJson } from '../../src/core/runtime/operator/terminal-safe-json.js';
import { createSourceExecutionLedgerRunOutputCommand } from '../../src/cli/cmds/ops_cmds/output.js';

const APP_ID = 'run-output-command-demo';
const OTHER_APP_ID = 'other-run-output-command-demo';
const REVISION_ID = `wrv1_${'A'.repeat(43)}`;
const RUN_ID = 'run-one';
const OTHER_RUN_ID = 'run-two';
const SAFE_FAILURE =
  'Sensitive durable run output could not be read safely. No partial output was emitted.';

afterEach(() => {
  process.exitCode = undefined;
  jest.restoreAllMocks();
});

function outputHarness() {
  return {
    json: jest.fn(
      (
        /** @type {Record<string, any>} */ _value,
        /** @type {string | undefined} */ _rendered = undefined,
      ) => {},
    ),
    table: jest.fn((/** @type {Array<Record<string, any>>} */ _rows) => {}),
    failure: jest.fn((/** @type {Error} */ _error) => {}),
  };
}

/** @param {Array<string>} [options] */
function argv(options = []) {
  return ['node', 'wharfie', ...options];
}

/** @param {import('commander').Command} command */
function silenceCommander(command) {
  command.exitOverride();
  command.configureOutput({
    writeOut: jest.fn(),
    writeErr: jest.fn(),
  });
  return command;
}

/** @param {Record<string, any>} [overrides] */
function structuredError(overrides = {}) {
  return {
    code: 'application-failed',
    name: 'Error',
    message: 'activity failed',
    details: { retryable: false },
    ...overrides,
  };
}

/**
 * @param {{
 *   scope?: Record<string, any>,
 *   snapshot?: Record<string, any>,
 *   outputs?: Record<string, any>[],
 *   terminal?: Record<string, any> | null,
 * }} [overrides]
 */
function runOutput(overrides = {}) {
  return {
    scope: {
      appId: APP_ID,
      revisionId: REVISION_ID,
      runId: RUN_ID,
      ...overrides.scope,
    },
    snapshot: {
      runKind: 'manual',
      status: 'RUNNING',
      version: 1,
      lastSequence: 1,
      ...overrides.snapshot,
    },
    outputs: overrides.outputs ?? [],
    terminal: Object.hasOwn(overrides, 'terminal') ? overrides.terminal : null,
  };
}

/** @param {ReturnType<typeof outputHarness>} output */
function expectNoRunOutput(output) {
  expect(output.json).not.toHaveBeenCalled();
  expect(output.table).not.toHaveBeenCalled();
}

describe('execution-ledger run-output command', () => {
  it('requires sensitive-output confirmation before packaged identity resolution or storage reads', async () => {
    const output = outputHarness();
    const resolveAppId = jest.fn(async () => APP_ID);
    const readOutput = jest.fn(async () => runOutput());
    const command = createExecutionLedgerRunOutputCommand({
      resolveAppId,
      readOutput,
      output,
    });

    await command.parseAsync(argv(['--run-id', RUN_ID, '--json']));

    expect(resolveAppId).not.toHaveBeenCalled();
    expect(readOutput).not.toHaveBeenCalled();
    expectNoRunOutput(output);
    expect(output.failure).toHaveBeenCalledTimes(1);
    expect(output.failure.mock.calls[0][0]).toMatchObject({
      message:
        'output requires --confirm-sensitive-output because durable run outputs are unredacted and may contain secrets.',
    });
    expect(process.exitCode).toBe(1);
  });

  it('requires sensitive-output confirmation before a source storage read', async () => {
    const output = outputHarness();
    const readOutput = jest.fn(async () => runOutput());
    const command = createExecutionLedgerRunOutputCommand({
      allowAppId: true,
      readOutput,
      output,
    });

    await command.parseAsync(
      argv(['--app-id', APP_ID, '--run-id', RUN_ID, '--json']),
    );

    expect(readOutput).not.toHaveBeenCalled();
    expectNoRunOutput(output);
    expect(output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('--confirm-sensitive-output'),
      }),
    );
    expect(process.exitCode).toBe(1);
  });

  it('emits the exact raw non-authoritative JSON envelope for a partial workflow', async () => {
    const output = outputHarness();
    const partial = runOutput({
      snapshot: {
        runKind: 'workflow',
        status: 'BLOCKED',
        version: 7,
        lastSequence: 12,
      },
      outputs: [
        {
          stepId: 'fetch-input',
          stepIndex: 0,
          value: {
            token: 'unredacted-secret',
            batches: [1, 2],
          },
        },
        {
          stepId: 'compile-result',
          stepIndex: 1,
          value: null,
        },
      ],
      terminal: null,
    });
    const readOutput = jest.fn(
      async (/** @type {{appId: string, runId: string}} */ _request) => partial,
    );
    const command = createExecutionLedgerRunOutputCommand({
      allowAppId: true,
      readOutput,
      output,
    });

    await command.parseAsync(
      argv([
        '--app-id',
        APP_ID,
        '--run-id',
        RUN_ID,
        '--confirm-sensitive-output',
        '--json',
      ]),
    );

    expect(readOutput).toHaveBeenCalledWith({
      appId: APP_ID,
      runId: RUN_ID,
    });
    expect(output.json.mock.calls[0][0]).toEqual({
      schemaVersion: EXECUTION_LEDGER_RUN_OUTPUT_SCHEMA_VERSION,
      kind: EXECUTION_LEDGER_RUN_OUTPUT_KIND,
      authority: 'none',
      authoritative: false,
      disclosure: EXECUTION_LEDGER_RUN_OUTPUT_DISCLOSURE,
      integrity: { verified: true },
      scope: {
        appId: APP_ID,
        revisionId: REVISION_ID,
        runId: RUN_ID,
      },
      snapshot: {
        runKind: 'workflow',
        status: 'BLOCKED',
        version: 7,
        lastSequence: 12,
      },
      outputs: [
        {
          stepId: 'fetch-input',
          stepIndex: 0,
          value: {
            token: 'unredacted-secret',
            batches: [1, 2],
          },
        },
        {
          stepId: 'compile-result',
          stepIndex: 1,
          value: null,
        },
      ],
      terminal: null,
    });
    expect(output.json.mock.calls[0][1]).toEqual(expect.any(String));
    const emitted = output.json.mock.calls[0][0];
    expect(Object.isFrozen(emitted)).toBe(true);
    expect(Object.isFrozen(emitted.scope)).toBe(true);
    expect(Object.isFrozen(emitted.outputs)).toBe(true);
    expect(Object.isFrozen(emitted.outputs[0].value)).toBe(true);
    expect(output.json).toHaveBeenCalledTimes(1);
    expect(output.table).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('distinguishes a completed JSON null result from a nonterminal snapshot', async () => {
    const output = outputHarness();
    const command = createExecutionLedgerRunOutputCommand({
      allowAppId: true,
      readOutput: async () =>
        runOutput({
          snapshot: {
            status: 'COMPLETED',
            version: 4,
            lastSequence: 6,
          },
          terminal: { type: 'completed', result: null },
        }),
      output,
    });

    await command.parseAsync(
      argv([
        '--app-id',
        APP_ID,
        '--run-id',
        RUN_ID,
        '--confirm-sensitive-output',
        '--json',
      ]),
    );

    expect(output.json.mock.calls[0][0]).toMatchObject({
      snapshot: { status: 'COMPLETED' },
      terminal: { type: 'completed', result: null },
    });
    expect(output.json.mock.calls[0][0].terminal).not.toBeNull();
    expect(output.failure).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'failure',
      status: 'FAILED',
      type: 'failed',
      error: structuredError(),
    },
    {
      label: 'cancellation',
      status: 'CANCELLED',
      type: 'cancelled',
      error: structuredError({
        code: 'operator-cancelled',
        name: 'AbortError',
        message: 'cancelled by operator',
        details: { requestId: 'cancel-one' },
      }),
    },
  ])(
    'preserves the exact structured $label terminal',
    async ({ status, type, error }) => {
      const output = outputHarness();
      const command = createExecutionLedgerRunOutputCommand({
        resolveAppId: async () => APP_ID,
        readOutput: async () =>
          runOutput({
            snapshot: {
              status,
              version: 5,
              lastSequence: 8,
            },
            terminal: { type, error },
          }),
        output,
      });

      await command.parseAsync(
        argv(['--run-id', RUN_ID, '--confirm-sensitive-output', '--json']),
      );

      expect(output.json.mock.calls[0][0]).toMatchObject({
        snapshot: { status },
        terminal: { type, error },
      });
      expect(output.failure).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    },
  );

  it.each([
    [
      'a private adapter error',
      async () => {
        throw new Error('private storage path /secret/run-output');
      },
    ],
    ['a missing run', async () => null],
    [
      'an extra top-level field',
      async () => ({
        ...runOutput(),
        privateEvidenceRef: 'must-never-be-emitted',
      }),
    ],
    [
      'a missing top-level field',
      async () => {
        const { terminal: _terminal, ...missingTerminal } = runOutput();
        return missingTerminal;
      },
    ],
    [
      'a cross-application scope',
      async () =>
        runOutput({
          scope: {
            appId: OTHER_APP_ID,
          },
        }),
    ],
    [
      'a cross-run scope',
      async () =>
        runOutput({
          scope: {
            runId: OTHER_RUN_ID,
          },
        }),
    ],
    [
      'a malformed second workflow output after a valid first output',
      async () =>
        runOutput({
          snapshot: {
            runKind: 'workflow',
            status: 'BLOCKED',
          },
          outputs: [
            {
              stepId: 'valid-first-step',
              stepIndex: 0,
              value: 'must-not-be-partially-emitted',
            },
            {
              stepId: 'private-second-step',
              stepIndex: 7,
              value: 'private-second-value',
            },
          ],
        }),
    ],
    [
      'duplicate workflow step identities',
      async () =>
        runOutput({
          snapshot: {
            runKind: 'workflow',
            status: 'BLOCKED',
          },
          outputs: [
            {
              stepId: 'duplicate-step',
              stepIndex: 0,
              value: 'first',
            },
            {
              stepId: 'duplicate-step',
              stepIndex: 1,
              value: 'second',
            },
          ],
        }),
    ],
    [
      'a completed workflow without a final output',
      async () =>
        runOutput({
          snapshot: {
            runKind: 'workflow',
            status: 'COMPLETED',
          },
          terminal: {
            type: 'completed',
            result: 'missing-output',
          },
        }),
    ],
    [
      'a completed workflow whose terminal differs from its final output',
      async () =>
        runOutput({
          snapshot: {
            runKind: 'workflow',
            status: 'COMPLETED',
          },
          outputs: [
            {
              stepId: 'final-step',
              stepIndex: 0,
              value: { result: 'retained-output' },
            },
          ],
          terminal: {
            type: 'completed',
            result: { result: 'different-terminal' },
          },
        }),
    ],
    [
      'an impossible cancelled effect successor',
      async () =>
        runOutput({
          snapshot: {
            runKind: 'effect-successor',
            status: 'CANCELLED',
          },
          terminal: {
            type: 'cancelled',
            error: structuredError({
              code: 'impossible-successor-cancel',
            }),
          },
        }),
    ],
    [
      'an unsupported deadline terminal',
      async () =>
        runOutput({
          snapshot: {
            status: 'FAILED',
          },
          terminal: {
            type: 'deadline-exceeded',
            error: structuredError({
              code: 'unsupported-deadline',
            }),
          },
        }),
    ],
    [
      'a protocol failure on an effect successor',
      async () =>
        runOutput({
          snapshot: {
            runKind: 'effect-successor',
            status: 'FAILED',
          },
          terminal: {
            type: 'protocol-failed',
            error: structuredError({
              code: 'impossible-successor-protocol',
            }),
          },
        }),
    ],
    [
      'a terminal with private extra state',
      async () =>
        runOutput({
          snapshot: {
            status: 'COMPLETED',
          },
          terminal: {
            type: 'completed',
            result: 'valid-looking-result',
            evidenceRef: 'private-terminal-evidence',
          },
        }),
    ],
    [
      'a terminal inconsistent with aggregate status',
      async () =>
        runOutput({
          snapshot: {
            status: 'FAILED',
          },
          terminal: {
            type: 'completed',
            result: 'private-inconsistent-result',
          },
        }),
    ],
  ])(
    'fails closed with one fixed redacted error and no partial output for %s',
    async (_name, readOutput) => {
      const output = outputHarness();
      const command = createExecutionLedgerRunOutputCommand({
        resolveAppId: async () => APP_ID,
        readOutput,
        output,
      });

      await command.parseAsync(
        argv(['--run-id', RUN_ID, '--confirm-sensitive-output', '--json']),
      );

      expectNoRunOutput(output);
      expect(output.failure).toHaveBeenCalledTimes(1);
      expect(output.failure.mock.calls[0][0]).toMatchObject({
        message: SAFE_FAILURE,
      });
      expect(output.failure.mock.calls[0][0].message).not.toMatch(
        /private|secret|evidence|must-not|inconsistent/,
      );
      expect(process.exitCode).toBe(1);
    },
  );

  it.each([
    ['--app-id', ['--run-id', RUN_ID]],
    ['--run-id', ['--app-id', APP_ID]],
  ])(
    'fails closed without reading storage when source mode is missing %s',
    async (_missing, supplied) => {
      const output = outputHarness();
      const readOutput = jest.fn(async () => runOutput());
      const command = createExecutionLedgerRunOutputCommand({
        allowAppId: true,
        readOutput,
        output,
      });

      await command.parseAsync(
        argv([...supplied, '--confirm-sensitive-output', '--json']),
      );

      expect(readOutput).not.toHaveBeenCalled();
      expectNoRunOutput(output);
      expect(output.failure).toHaveBeenCalledTimes(1);
      expect(output.failure.mock.calls[0][0]).toMatchObject({
        message: SAFE_FAILURE,
      });
      expect(process.exitCode).toBe(1);
    },
  );

  it('renders every human application value as terminal-inert JSON text before output', async () => {
    const output = outputHarness();
    const hostileValue = {
      'direction\u2066': 'escape\u001b c1\u009b bidi\u202e',
    };
    const command = createExecutionLedgerRunOutputCommand({
      allowAppId: true,
      readOutput: async () =>
        runOutput({
          snapshot: {
            runKind: 'workflow',
            status: 'COMPLETED',
            version: 3,
            lastSequence: 5,
          },
          outputs: [
            {
              stepId: 'hostile-result',
              stepIndex: 0,
              value: hostileValue,
            },
          ],
          terminal: {
            type: 'completed',
            result: hostileValue,
          },
        }),
      output,
    });

    await command.parseAsync(
      argv([
        '--app-id',
        APP_ID,
        '--run-id',
        RUN_ID,
        '--confirm-sensitive-output',
      ]),
    );

    expect(output.table).toHaveBeenCalledWith([
      {
        entry: 'scope',
        step_index: '',
        step_id_json: '',
        value_json: `{"appId":"${APP_ID}","revisionId":"${REVISION_ID}","runId":"${RUN_ID}"}`,
      },
      {
        entry: 'snapshot',
        step_index: '',
        step_id_json: '',
        value_json:
          '{"runKind":"workflow","status":"COMPLETED","version":3,"lastSequence":5}',
      },
      {
        entry: 'output',
        step_index: 0,
        step_id_json: '"hostile-result"',
        value_json:
          '{"direction\\u2066":"escape\\u001b c1\\u009b bidi\\u202e"}',
      },
      {
        entry: 'terminal',
        step_index: '',
        step_id_json: '',
        value_json:
          '{"type":"completed","result":{"direction\\u2066":"escape\\u001b c1\\u009b bidi\\u202e"}}',
      },
    ]);
    const renderedRows = JSON.stringify(output.table.mock.calls);
    expect(renderedRows).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
    expect(output.json).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
  });

  it('writes terminal-inert JSON text while preserving exact raw parsed values', async () => {
    const write = jest.spyOn(console, 'log').mockImplementation(() => {});
    const hostileResult = {
      'key\u2066': 'escape\u001b c1\u009b bidi\u202e line\u2028',
    };
    const command = createExecutionLedgerRunOutputCommand({
      allowAppId: true,
      readOutput: async () =>
        runOutput({
          snapshot: {
            status: 'COMPLETED',
            version: 2,
            lastSequence: 4,
          },
          terminal: {
            type: 'completed',
            result: hostileResult,
          },
        }),
    });

    await command.parseAsync(
      argv([
        '--app-id',
        APP_ID,
        '--run-id',
        RUN_ID,
        '--confirm-sensitive-output',
        '--json',
      ]),
    );

    expect(write).toHaveBeenCalledTimes(1);
    const text = write.mock.calls[0][0];
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u);
    expect(text).toContain('\\u001b');
    expect(text).toContain('\\u009b');
    expect(text).toContain('\\u202e');
    expect(text).toContain('\\u2028');
    const parsed = JSON.parse(text);
    expect(parsed.terminal).toEqual({
      type: 'completed',
      result: hostileResult,
    });
    expect(process.exitCode).toBeUndefined();
  });

  it('bounds the emitted terminal-safe encoding after control characters expand', () => {
    const value = { value: '\u0085'.repeat(10) };
    expect(
      Buffer.byteLength(JSON.stringify(value), 'utf8'),
    ).toBeLessThanOrEqual(40);
    expect(() =>
      renderBoundedTerminalSafeJson(value, 40, 'expanded test document'),
    ).toThrow('expanded test document exceeds its encoded byte limit');
  });

  it('does not claim no partial output after an output port starts and then fails', async () => {
    /** @type {string[]} */
    const partialWrites = [];
    const output = {
      json: jest.fn(() => {
        partialWrites.push('started');
        throw new Error('injected output stream failure');
      }),
      table: jest.fn(),
      failure: jest.fn(),
    };
    const command = createExecutionLedgerRunOutputCommand({
      allowAppId: true,
      readOutput: async () => runOutput(),
      output,
    });

    await expect(
      command.parseAsync(
        argv([
          '--app-id',
          APP_ID,
          '--run-id',
          RUN_ID,
          '--confirm-sensitive-output',
          '--json',
        ]),
      ),
    ).rejects.toThrow('injected output stream failure');

    expect(partialWrites).toEqual(['started']);
    expect(output.failure).not.toHaveBeenCalled();
    expect(output.table).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('creates fresh source and packaged commands with exact identity-specific options', async () => {
    const sourceOne = createSourceExecutionLedgerRunOutputCommand();
    const sourceTwo = createSourceExecutionLedgerRunOutputCommand();
    expect(sourceOne).not.toBe(sourceTwo);
    expect(sourceOne.name()).toBe('output');
    expect(sourceOne.description()).toBe(
      'Read one run’s verified sensitive durable output snapshot',
    );
    expect(sourceOne.options.map((option) => option.flags)).toEqual([
      '--app-id <appId>',
      '--run-id <runId>',
      '--confirm-sensitive-output',
      '--json',
    ]);

    const output = outputHarness();
    const resolveAppId = jest.fn(async () => APP_ID);
    const readOutput = jest.fn(async () => runOutput());
    const packagedOne = silenceCommander(
      createExecutionLedgerRunOutputCommand({
        resolveAppId,
        readOutput,
        output,
      }),
    );
    const packagedTwo = createExecutionLedgerRunOutputCommand({
      resolveAppId: async () => APP_ID,
      readOutput,
      output,
    });
    expect(packagedOne).not.toBe(packagedTwo);
    expect(packagedOne.options.map((option) => option.flags)).toEqual([
      '--run-id <runId>',
      '--confirm-sensitive-output',
      '--json',
    ]);

    await expect(
      packagedOne.parseAsync(
        argv([
          '--app-id',
          OTHER_APP_ID,
          '--run-id',
          RUN_ID,
          '--confirm-sensitive-output',
        ]),
      ),
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });

    expect(resolveAppId).not.toHaveBeenCalled();
    expect(readOutput).not.toHaveBeenCalled();
    expectNoRunOutput(output);
    expect(output.failure).not.toHaveBeenCalled();
  });
});
