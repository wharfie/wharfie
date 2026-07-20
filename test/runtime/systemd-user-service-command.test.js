/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';

import { createProgram } from '../../src/core/resources/builds/actor-system-cli/index.js';
import sourceOpsCommand from '../../src/cli/cmds/ops.js';
import { createSystemdUserServiceCommand } from '../../src/core/runtime/operator/systemd-user-service-command.js';

const ACTIONS = Object.freeze([
  'install',
  'start',
  'stop',
  'restart',
  'status',
  'uninstall',
]);

function makeOperator() {
  return Object.fromEntries(
    ACTIONS.map((action) => [
      action,
      jest.fn(async () => ({
        schemaVersion: action === 'status' ? 2 : 1,
        kind:
          action === 'status'
            ? 'wharfie.service.status'
            : 'wharfie.service.result',
        appId: 'service-demo',
        ...(action === 'status'
          ? {
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
            }
          : { action, outcome: 'completed' }),
      })),
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
    expect(service?.commands.map((command) => command.name())).not.toEqual(
      expect.arrayContaining(['update', 'rollback']),
    );
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
    [
      'start',
      {
        schemaVersion: 1,
        kind: 'wharfie.service.result',
        action: 'stop',
        appId: 'service-demo',
        outcome: 'stopped',
      },
    ],
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

  it('prints one safe JSON error and marks command failure', async () => {
    const failure = jest.fn();
    const json = jest.fn();
    const line = jest.fn();
    const processRef = { exitCode: undefined };
    const command = createSystemdUserServiceCommand({
      loadOperator: async () => ({
        ...makeOperator(),
        install: async () => {
          throw new Error('systemd user manager is unavailable');
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
      code: 'systemd-user-service-operation-failed',
      message: 'systemd user manager is unavailable',
    });
    expect(failure).not.toHaveBeenCalled();
    expect(line).not.toHaveBeenCalled();
    expect(processRef.exitCode).toBe(1);
  });

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
