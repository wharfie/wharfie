/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';

import { createProgram } from '../../src/core/resources/builds/actor-system-cli/index.js';
import sourceOpsCommand from '../../src/cli/cmds/ops.js';
import { createSystemdUserServiceCommand } from '../../src/core/runtime/operator/systemd-user-service-command.js';

/** @typedef {'install'|'converge'|'update'|'rollback'|'recover'|'start'|'stop'|'restart'|'uninstall'} ServiceResultAction */

/** @type {ReadonlyArray<ServiceResultAction|'status'>} */
const ACTIONS = Object.freeze([
  'install',
  'converge',
  'update',
  'rollback',
  'recover',
  'start',
  'stop',
  'restart',
  'status',
  'uninstall',
]);

const OUTCOMES = Object.freeze({
  install: 'target-active',
  converge: 'target-active',
  update: 'target-active',
  rollback: 'target-active',
  recover: 'target-active',
  start: 'started',
  stop: 'stopped',
  restart: 'restarted',
  uninstall: 'uninstalled',
});

/** @type {Array<[ServiceResultAction, string, string, string]>} */
const HUMAN_ACTIVATION_CASES = [
  [
    'update',
    'refused',
    'source-retained',
    'update: source retained; request refused (service-demo)',
  ],
  [
    'rollback',
    'failed',
    'source-restored',
    'rollback: source restored; request failed (service-demo)',
  ],
  [
    'recover',
    'pending',
    'in-flight',
    'recover: in-flight; request pending; run service recover (service-demo)',
  ],
  [
    'converge',
    'pending',
    'in-flight',
    'converge: in-flight; request pending; retry service converge (service-demo)',
  ],
];

/** @type {Array<[ServiceResultAction, string, string, Record<string, any>]>} */
const JSON_NONFULFILLED_CASES = [
  ['update', 'refused', 'source-retained', {}],
  ['rollback', 'failed', 'source-restored', {}],
  ['converge', 'pending', 'in-flight', {}],
  [
    'install',
    'pending',
    'in-flight',
    {
      health: 'degraded',
      activeArtifactId: null,
      activeRevisionId: null,
      rollbackArtifactId: null,
      rollbackRevisionId: null,
    },
  ],
];

/**
 * @param {ServiceResultAction} action - Result action.
 * @param {Record<string, any>} [overrides] - Receipt overrides.
 * @returns {Record<string, any>} - Complete service result.
 */
function makeResult(action, overrides = {}) {
  return {
    schemaVersion: 1,
    kind: 'wharfie.service.result',
    appId: 'service-demo',
    action,
    requestStatus: 'fulfilled',
    outcome: OUTCOMES[action],
    health:
      action === 'stop'
        ? 'stopped'
        : action === 'uninstall'
          ? 'absent'
          : 'healthy',
    activeArtifactId: action === 'uninstall' ? null : 'artifact-current',
    activeRevisionId: action === 'uninstall' ? null : 'revision-current',
    rollbackArtifactId: ['update', 'rollback', 'recover'].includes(action)
      ? 'artifact-previous'
      : null,
    rollbackRevisionId: ['update', 'rollback', 'recover'].includes(action)
      ? 'revision-previous'
      : null,
    ...overrides,
  };
}

/**
 * @param {Record<string, any>} value - Receipt to copy.
 * @param {string} field - Field to omit.
 * @returns {Record<string, any>} - Copied receipt without the field.
 */
function withoutField(value, field) {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

function makeOperator() {
  return Object.fromEntries(
    ACTIONS.map((action) => [
      action,
      jest.fn(async () => {
        if (action !== 'status') return makeResult(action);
        return {
          schemaVersion: 2,
          kind: 'wharfie.service.status',
          appId: 'service-demo',
          health: 'healthy',
          installation: { state: 'installed' },
          systemd: { activeState: 'active' },
          wiring: {
            state: 'managed',
            unitFile: 'managed',
            selection: 'managed',
            effectiveUnit: 'managed',
            cleanupPending: false,
          },
        };
      }),
    ]),
  );
}

describe('packaged systemd user service command', () => {
  it('mounts only the intended packaged lifecycle operations and loads no host implementation for help', () => {
    const loadOperator = jest.fn();
    const packaged = createProgram({
      loadSystemdUserServiceOperator: loadOperator,
    });
    const service = packaged.commands.find(
      (command) => command.name() === 'service',
    );

    expect(service).toBeDefined();
    expect(service?.commands.map((command) => command.name())).toEqual(ACTIONS);
    expect(
      service?.commands.every((command) =>
        command.options.some((option) => option.long === '--json'),
      ),
    ).toBe(true);
    expect(
      sourceOpsCommand.commands.map((command) => command.name()),
    ).not.toContain('service');
    expect(packaged.helpInformation()).toContain('service');
    expect(service?.helpInformation()).toContain('install');
    expect(service?.helpInformation()).toContain('converge');
    expect(service?.helpInformation()).toContain('update');
    expect(service?.helpInformation()).toContain('rollback');
    expect(service?.helpInformation()).toContain('recover');
    expect(service?.helpInformation()).toContain('uninstall');
    expect(loadOperator).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)(
    'delegates service %s and writes exactly one JSON object',
    async (action) => {
      const operator = makeOperator();
      const loadOperator = jest.fn(async () => operator);
      const json = jest.fn();
      const line = jest.fn();
      const failure = jest.fn();
      const processRef = { exitCode: undefined };
      const command = createSystemdUserServiceCommand({
        loadOperator,
        output: { json, line, failure },
        processRef,
      });

      await command.parseAsync(['node', 'service', action, '--json']);

      expect(loadOperator).toHaveBeenCalledTimes(1);
      expect(operator[action]).toHaveBeenCalledTimes(1);
      for (const otherAction of ACTIONS.filter((name) => name !== action)) {
        expect(operator[otherAction]).not.toHaveBeenCalled();
      }
      expect(json).toHaveBeenCalledTimes(1);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining(
          action === 'status'
            ? {
                kind: 'wharfie.service.status',
                appId: 'service-demo',
                health: 'healthy',
              }
            : { action, appId: 'service-demo' },
        ),
      );
      expect(line).not.toHaveBeenCalled();
      expect(failure).not.toHaveBeenCalled();
      expect(processRef.exitCode).toBeUndefined();
    },
  );

  it('writes a concise human status line', async () => {
    const operator = makeOperator();
    const line = jest.fn();
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => operator,
      output: { line },
      processRef: { exitCode: undefined },
    });

    await command.parseAsync(['node', 'service', 'status']);

    expect(line).toHaveBeenCalledTimes(1);
    expect(line).toHaveBeenCalledWith(
      'status: healthy; wiring: managed (service-demo)',
    );
  });

  it('makes orphan cleanup actionable in human status output', async () => {
    const operator = makeOperator();
    operator.status.mockResolvedValue({
      schemaVersion: 2,
      kind: 'wharfie.service.status',
      appId: 'service-demo',
      health: 'degraded',
      installation: { state: 'absent' },
      systemd: { activeState: 'active' },
      wiring: {
        state: 'orphaned',
        unitFile: 'managed',
        selection: 'absent',
        effectiveUnit: 'managed',
        cleanupPending: false,
      },
    });
    const line = jest.fn();
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => operator,
      output: { line },
      processRef: { exitCode: undefined },
    });

    await command.parseAsync(['node', 'service', 'status']);

    expect(line).toHaveBeenCalledWith(
      'status: degraded; wiring: orphaned; run service uninstall (service-demo)',
    );
  });

  it('makes an in-flight activation actionable in human status output', async () => {
    const operator = makeOperator();
    operator.status.mockResolvedValue({
      schemaVersion: 2,
      kind: 'wharfie.service.status',
      appId: 'service-demo',
      health: 'degraded',
      activation: { phase: 'QUIESCING', action: 'update' },
      wiring: {
        state: 'managed',
        unitFile: 'managed',
        selection: 'managed',
        effectiveUnit: 'managed',
        cleanupPending: false,
      },
    });
    const line = jest.fn();
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => operator,
      output: { line },
      processRef: { exitCode: undefined },
    });

    await command.parseAsync(['node', 'service', 'status']);

    expect(line).toHaveBeenCalledWith(
      'status: degraded; wiring: managed; activation: QUIESCING; run service recover (service-demo)',
    );
  });

  it('prioritizes activation recovery over orphan cleanup guidance', async () => {
    const operator = makeOperator();
    operator.status.mockResolvedValue({
      schemaVersion: 2,
      kind: 'wharfie.service.status',
      appId: 'service-demo',
      health: 'degraded',
      activation: { phase: 'SELECTED', action: 'update' },
      wiring: {
        state: 'orphaned',
        unitFile: 'managed',
        selection: 'absent',
        effectiveUnit: 'managed',
        cleanupPending: false,
      },
    });
    const line = jest.fn();
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => operator,
      output: { line },
      processRef: { exitCode: undefined },
    });

    await command.parseAsync(['node', 'service', 'status']);

    expect(line).toHaveBeenCalledWith(
      'status: degraded; wiring: orphaned; activation: SELECTED; run service recover (service-demo)',
    );
  });

  it.each(HUMAN_ACTIVATION_CASES)(
    'writes an actionable human %s result for %s activation',
    async (action, requestStatus, outcome, message) => {
      const operator = makeOperator();
      operator[action].mockResolvedValue(
        makeResult(action, { requestStatus, outcome }),
      );
      const line = jest.fn();
      const processRef = { exitCode: undefined };
      const command = createSystemdUserServiceCommand({
        loadOperator: async () => operator,
        output: { line },
        processRef,
      });

      await command.parseAsync(['node', 'service', action]);

      expect(line).toHaveBeenCalledWith(message);
      expect(processRef.exitCode).toBe(1);
    },
  );

  it('does not suggest recovery alone for incompatible first-install work', async () => {
    const operator = makeOperator();
    operator.install.mockResolvedValue(
      makeResult('install', {
        requestStatus: 'pending',
        outcome: 'in-flight',
        reason: 'incompatible-durable-work',
        health: 'degraded',
        activeArtifactId: null,
        activeRevisionId: null,
      }),
    );
    const line = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => operator,
      output: { line },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'install']);

    expect(line).toHaveBeenCalledWith(
      'install: in-flight; request pending; settle incompatible durable work, then run service recover; or install its matching revision (service-demo)',
    );
    expect(processRef.exitCode).toBe(1);
  });

  it('accepts a transient starting health in an activation receipt', async () => {
    const operator = makeOperator();
    operator.update.mockResolvedValue(
      makeResult('update', { health: 'starting' }),
    );
    const line = jest.fn();
    const failure = jest.fn();
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => operator,
      output: { line, failure },
      processRef: { exitCode: undefined },
    });

    await command.parseAsync(['node', 'service', 'update']);

    expect(line).toHaveBeenCalledWith('update: target-active (service-demo)');
    expect(failure).not.toHaveBeenCalled();
  });

  it.each([
    ['source-retained', 'recover: source retained (service-demo)'],
    ['source-restored', 'recover: source restored (service-demo)'],
    ['absent', 'recover: absent (service-demo)'],
  ])('accepts fulfilled recovery settlement %s', async (outcome, message) => {
    const operator = makeOperator();
    operator.recover.mockResolvedValue(
      makeResult('recover', {
        outcome,
        ...(outcome === 'absent'
          ? {
              health: 'absent',
              activeArtifactId: null,
              activeRevisionId: null,
              rollbackArtifactId: null,
              rollbackRevisionId: null,
            }
          : {}),
      }),
    );
    const line = jest.fn();
    const failure = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => operator,
      output: { line, failure },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'recover']);

    expect(line).toHaveBeenCalledWith(message);
    expect(failure).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBeUndefined();
  });

  it.each(JSON_NONFULFILLED_CASES)(
    'emits a safe %s %s receipt as JSON and marks the request unsuccessful',
    async (action, requestStatus, outcome, overrides) => {
      const operator = makeOperator();
      operator[action].mockResolvedValue(
        makeResult(action, { requestStatus, outcome, ...overrides }),
      );
      const json = jest.fn();
      const failure = jest.fn();
      const processRef = { exitCode: undefined };
      const command = createSystemdUserServiceCommand({
        loadOperator: async () => operator,
        output: { json, failure },
        processRef,
      });

      await command.parseAsync(['node', 'service', action, '--json']);

      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ action, requestStatus, outcome }),
      );
      expect(failure).not.toHaveBeenCalled();
      expect(processRef.exitCode).toBe(1);
    },
  );

  it.each([
    [
      'absent settlement',
      {
        outcome: 'absent',
        health: 'absent',
        activeArtifactId: null,
        activeRevisionId: null,
      },
    ],
    ['degraded target', { health: 'degraded' }],
    ['unproven target', { activeArtifactId: null, activeRevisionId: null }],
  ])('rejects fulfilled converge with %s', async (_label, overrides) => {
    const operator = makeOperator();
    operator.converge.mockResolvedValue(makeResult('converge', overrides));
    const line = jest.fn();
    const failure = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => operator,
      output: { line, failure },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'converge']);

    expect(line).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).toMatchObject({
      message: expect.stringMatching(/invalid receipt/),
    });
    expect(processRef.exitCode).toBe(1);
  });

  it.each([
    ['status', { schemaVersion: 1, kind: 'wharfie.service.result' }],
    [
      'status',
      {
        schemaVersion: 1,
        kind: 'wharfie.service.status',
        appId: 'service-demo',
        health: 'healthy',
        wiring: {
          state: 'managed',
          unitFile: 'managed',
          selection: 'managed',
          effectiveUnit: 'managed',
          cleanupPending: false,
        },
      },
    ],
    ['start', makeResult('stop')],
    ['update', withoutField(makeResult('update'), 'requestStatus')],
    ['update', makeResult('update', { requestStatus: 'waiting' })],
    ['update', withoutField(makeResult('update'), 'health')],
    ['update', makeResult('update', { health: 'unknown' })],
    ['update', makeResult('update', { outcome: 'installed' })],
    ['update', makeResult('update', { settledOutcome: 'target-active' })],
    [
      'update',
      makeResult('update', {
        requestStatus: 'pending',
        outcome: 'target-active',
      }),
    ],
    [
      'update',
      makeResult('update', {
        requestStatus: 'refused',
        outcome: 'source-restored',
      }),
    ],
    [
      'rollback',
      makeResult('rollback', {
        requestStatus: 'failed',
        outcome: 'source-retained',
      }),
    ],
    [
      'recover',
      makeResult('recover', {
        requestStatus: 'fulfilled',
        outcome: 'in-flight',
      }),
    ],
    [
      'start',
      makeResult('start', {
        requestStatus: 'pending',
        outcome: 'started',
      }),
    ],
    ['start', makeResult('start', { outcome: 'stopped' })],
    ['stop', makeResult('stop', { health: 'starting' })],
    ['update', withoutField(makeResult('update'), 'activeArtifactId')],
    ['update', makeResult('update', { activeArtifactId: null })],
    ['update', makeResult('update', { activeArtifactId: 42 })],
    ['rollback', makeResult('rollback', { rollbackRevisionId: null })],
    ['rollback', makeResult('rollback', { rollbackArtifactId: null })],
    ['rollback', makeResult('rollback', { rollbackArtifactId: '' })],
  ])('fails closed on a malformed %s receipt', async (action, receipt) => {
    const failure = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        [action]: async () => receipt,
      }),
      output: { failure },
      processRef,
    });

    await command.parseAsync(['node', 'service', action]);

    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).toMatchObject({
      message: expect.stringMatching(/invalid receipt/),
    });
    expect(processRef.exitCode).toBe(1);
  });

  it('prints recovery guidance only for a tagged in-flight activation JSON error', async () => {
    const failure = jest.fn();
    const json = jest.fn();
    const line = jest.fn();
    const processRef = { exitCode: undefined };
    const activationError = Object.assign(
      new Error('systemd user manager is unavailable\nretry required'),
      {
        code: 'systemd-user-service-activation-recovery-required',
        remediation: 'Run service recover before retrying activation.',
        secret: 'must-not-appear',
      },
    );
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        install: async () => {
          throw activationError;
        },
      }),
      output: { failure, json, line },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'install', '--json']);

    expect(json).toHaveBeenCalledTimes(1);
    expect(json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.service.error',
      action: 'install',
      code: 'systemd-user-service-activation-recovery-required',
      message: 'systemd user manager is unavailable retry required',
      remediation: 'Run service recover before retrying activation.',
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain(
      'must-not-appear',
    );
    expect(failure).not.toHaveBeenCalled();
    expect(line).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBe(1);
  });

  it('prints a safe tagged human activation error with recovery guidance', async () => {
    const failure = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        update: async () => {
          throw Object.assign(new Error('activation interrupted\nmid-flight'), {
            code: 'systemd-user-service-activation-recovery-required',
            remediation: 'Run service recover before retrying activation.',
            secret: 'must-not-appear',
          });
        },
      }),
      output: { failure },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'update']);

    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).toMatchObject({
      message:
        'activation interrupted mid-flight Run service recover before retrying activation.',
    });
    expect(failure.mock.calls[0][0]).not.toHaveProperty('secret');
    expect(processRef.exitCode).toBe(1);
  });

  it('directs an ambiguous desired-target operation back through service converge', async () => {
    const json = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        converge: async () => {
          throw Object.assign(new Error('desired activation interrupted'), {
            code: 'systemd-user-service-activation-recovery-required',
            remediation: 'Retry service converge from this exact desired SEA.',
          });
        },
      }),
      output: { json },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'converge', '--json']);

    expect(json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.service.error',
      action: 'converge',
      code: 'systemd-user-service-activation-recovery-required',
      message: 'desired activation interrupted',
      remediation: 'Retry service converge from this exact desired SEA.',
    });
    expect(processRef.exitCode).toBe(1);
  });

  it('directs interrupted desired-target repair back through service converge', async () => {
    const json = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        converge: async () => {
          throw Object.assign(new Error('desired repair interrupted'), {
            code: 'systemd-user-service-active-reinstall-recovery-required',
            remediation: 'Retry service converge from this exact desired SEA.',
          });
        },
      }),
      output: { json },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'converge', '--json']);

    expect(json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.service.error',
      action: 'converge',
      code: 'systemd-user-service-active-reinstall-recovery-required',
      message: 'desired repair interrupted',
      remediation: 'Retry service converge from this exact desired SEA.',
    });
    expect(processRef.exitCode).toBe(1);
  });

  it('requires direction-neutral recovery before convergence can cross a rollback', async () => {
    const json = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        converge: async () => {
          throw Object.assign(new Error('rollback remains in flight'), {
            code: 'systemd-user-service-converge-rollback-recovery-required',
            remediation:
              'Run service recover before retrying desired-target convergence.',
          });
        },
      }),
      output: { json },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'converge', '--json']);

    expect(json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.service.error',
      action: 'converge',
      code: 'systemd-user-service-converge-rollback-recovery-required',
      message: 'rollback remains in flight',
      remediation:
        'Run service recover before retrying desired-target convergence.',
    });
    expect(processRef.exitCode).toBe(1);
  });

  it('preserves retry guidance when exact convergence proof is lost', async () => {
    const json = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        converge: async () => {
          throw Object.assign(new Error('exact health proof was lost'), {
            code: 'systemd-user-service-converge-proof-required',
            remediation: 'Retry service converge from this exact desired SEA.',
          });
        },
      }),
      output: { json },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'converge', '--json']);

    expect(json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.service.error',
      action: 'converge',
      code: 'systemd-user-service-converge-proof-required',
      message: 'exact health proof was lost',
      remediation: 'Retry service converge from this exact desired SEA.',
    });
    expect(processRef.exitCode).toBe(1);
  });

  it('prints exact active-reinstall repair guidance as JSON', async () => {
    const failure = jest.fn();
    const json = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        install: async () => {
          throw Object.assign(new Error('reinstall interrupted\nmid-repair'), {
            code: 'systemd-user-service-active-reinstall-recovery-required',
            remediation:
              'Run service install again from the exact selected SEA to resume repair.',
            secret: 'must-not-appear',
          });
        },
      }),
      output: { failure, json },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'install', '--json']);

    expect(json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.service.error',
      action: 'install',
      code: 'systemd-user-service-active-reinstall-recovery-required',
      message: 'reinstall interrupted mid-repair',
      remediation:
        'Run service install again from the exact selected SEA to resume repair.',
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain(
      'must-not-appear',
    );
    expect(failure).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBe(1);
  });

  it('prints safe active-reinstall repair guidance for humans', async () => {
    const failure = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        install: async () => {
          throw Object.assign(new Error('reinstall interrupted\nmid-repair'), {
            code: 'systemd-user-service-active-reinstall-recovery-required',
            remediation:
              'Run service install again from the exact selected SEA to resume repair.',
            secret: 'must-not-appear',
          });
        },
      }),
      output: { failure },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'install']);

    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).toMatchObject({
      code: 'systemd-user-service-active-reinstall-recovery-required',
      message:
        'reinstall interrupted mid-repair Run service install again from the exact selected SEA to resume repair.',
    });
    expect(failure.mock.calls[0][0]).not.toHaveProperty('secret');
    expect(processRef.exitCode).toBe(1);
  });

  it('does not recommend recovery for an activation preflight failure', async () => {
    const failure = jest.fn();
    const json = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        install: async () => {
          throw Object.assign(new Error('lingering is required'), {
            code: 'systemd-user-service-preflight-failed',
          });
        },
      }),
      output: { failure, json },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'install', '--json']);

    expect(json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.service.error',
      action: 'install',
      code: 'systemd-user-service-preflight-failed',
      message: 'lingering is required',
    });
    expect(processRef.exitCode).toBe(1);
  });

  it('sanitizes an untagged human activation preflight failure', async () => {
    const failure = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        install: async () => {
          throw Object.assign(new Error('lingering\nis\u001brequired'), {
            code: 'systemd-user-service-preflight-failed',
            secret: 'must-not-appear',
          });
        },
      }),
      output: { failure },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'install']);

    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).toMatchObject({
      code: 'systemd-user-service-preflight-failed',
      message: 'lingering is required',
    });
    expect(failure.mock.calls[0][0]).not.toHaveProperty('remediation');
    expect(failure.mock.calls[0][0]).not.toHaveProperty('secret');
    expect(processRef.exitCode).toBe(1);
  });

  it.each([
    [
      'missing activation',
      'systemd-user-service-activation-recovery-required',
      undefined,
    ],
    [
      'wrong activation',
      'systemd-user-service-activation-recovery-required',
      'Retry service install or service converge from the exact selected SEA.',
    ],
    [
      'missing active-reinstall',
      'systemd-user-service-active-reinstall-recovery-required',
      undefined,
    ],
    [
      'wrong active-reinstall',
      'systemd-user-service-active-reinstall-recovery-required',
      'Run service recover before retrying activation.',
    ],
    [
      'rollback-only convergence',
      'systemd-user-service-converge-rollback-recovery-required',
      'Run service recover before retrying desired-target convergence.',
    ],
    [
      'proof-only convergence',
      'systemd-user-service-converge-proof-required',
      'Retry service converge from this exact desired SEA.',
    ],
  ])(
    'does not trust %s remediation on a recovery-coded error',
    async (_label, code, remediation) => {
      const json = jest.fn();
      const processRef = { exitCode: undefined };
      const command = createSystemdUserServiceCommand({
        loadOperator: async () => ({
          ...makeOperator(),
          update: async () => {
            const error = Object.assign(new Error('activation interrupted'), {
              code,
            });
            if (remediation !== undefined) {
              Object.assign(error, { remediation });
            }
            throw error;
          },
        }),
        output: { json },
        processRef,
      });

      await command.parseAsync(['node', 'service', 'update', '--json']);

      expect(json).toHaveBeenCalledWith({
        schemaVersion: 1,
        kind: 'wharfie.service.error',
        action: 'update',
        code,
        message: 'activation interrupted',
      });
      expect(processRef.exitCode).toBe(1);
    },
  );

  it('fails closed when the implementation omits the requested method', async () => {
    const failure = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({}),
      output: { failure },
      processRef,
    });

    await command.parseAsync(['node', 'service', 'restart']);

    expect(failure).toHaveBeenCalledTimes(1);
    expect(failure.mock.calls[0][0]).toMatchObject({
      message: expect.stringMatching(/does not implement restart\(\)/),
    });
    expect(processRef.exitCode).toBe(1);
  });
});
