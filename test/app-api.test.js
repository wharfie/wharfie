/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';

import { defineApp } from '../src/app.js';

/**
 * @param {any} definition - Runtime-only authoring input.
 * @returns {any} - Runtime facade result.
 */
function defineUntypedApp(definition) {
  return defineApp(definition);
}

describe('defineApp source authoring facade', () => {
  it('preserves a fully explicit v4 source manifest by identity', () => {
    const explicit = {
      schemaVersion: 4,
      app: { id: 'explicit-app' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: './src/cli.js',
          export: 'main',
        },
      },
    };

    expect(defineUntypedApp(explicit)).toBe(explicit);
  });

  it('expands the smallest shorthand into mechanical v4 CLI boilerplate', () => {
    expect(
      defineUntypedApp({
        id: 'small-app',
        main: './src/cli.js',
      }),
    ).toEqual({
      schemaVersion: 4,
      app: { id: 'small-app' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: './src/cli.js',
          export: 'main',
        },
      },
    });
  });

  it('uses only explicit logical IDs and unambiguous module conventions', () => {
    expect(
      defineUntypedApp({
        id: 'durable-app',
        main: './src/cli.js',
        durable: 'greet-later',
        activityModule: './src/activities.js',
        targets: [
          { nodeVersion: '24.13.1', platform: 'darwin', architecture: 'arm64' },
        ],
        activities: {
          prepare: {},
          'say-hello': { export: 'sayHello' },
          finish: {
            path: './src/finish.js',
            externalPackages: [{ name: 'example', version: '1.2.3' }],
          },
        },
        workflows: {
          'greet-later': { steps: [{ id: 'done', kind: 'signal' }] },
        },
        schedules: {
          nightly: {
            cron: '0 0 * * *',
            workflow: 'greet-later',
            input: {},
            missed: 'latest',
            overlap: 'allow',
          },
        },
      }),
    ).toEqual({
      schemaVersion: 4,
      app: { id: 'durable-app' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: './src/cli.js',
          export: 'main',
        },
        durable: {
          workflow: 'greet-later',
          export: 'toDurableInput',
        },
      },
      targets: [
        { nodeVersion: '24.13.1', platform: 'darwin', architecture: 'arm64' },
      ],
      activities: {
        prepare: {
          entrypoint: {
            kind: 'node',
            path: './src/activities.js',
            export: 'prepare',
          },
        },
        'say-hello': {
          entrypoint: {
            kind: 'node',
            path: './src/activities.js',
            export: 'sayHello',
          },
        },
        finish: {
          entrypoint: {
            kind: 'node',
            path: './src/finish.js',
            export: 'finish',
          },
          externalPackages: [{ name: 'example', version: '1.2.3' }],
        },
      },
      workflows: {
        'greet-later': { steps: [{ id: 'done', kind: 'signal' }] },
      },
      schedules: {
        nightly: {
          cron: '0 0 * * *',
          workflow: 'greet-later',
          input: {},
          missed: 'latest',
          overlap: 'allow',
        },
      },
    });
  });

  it('rejects shorthand ambiguity instead of inventing application semantics', () => {
    expect(() =>
      defineUntypedApp({ id: 'bad-app', main: './cli.js', unsupported: true }),
    ).toThrow(/unsupported/);
    expect(() =>
      defineUntypedApp({
        id: 'bad-app',
        main: './cli.js',
        activityModule: './activities.js',
        activities: {},
      }),
    ).toThrow(/at least one declared activity/);

    expect(() =>
      defineUntypedApp({
        id: 'bad-app',
        main: './cli.js',
        activities: { greet: {} },
      }),
    ).toThrow(/requires path or defineApp.activityModule/);
    expect(() =>
      defineUntypedApp({
        id: 'bad-app',
        main: './cli.js',
        activityModule: './activities.js',
        activities: { 'say-hello': {} },
      }),
    ).toThrow(/export is required/);
  });

  it.each([
    ['path', null],
    ['path', ''],
    ['path', 42],
    ['export', null],
    ['export', ''],
    ['export', 42],
  ])(
    'rejects a present invalid activity %s instead of applying a convention',
    (field, value) => {
      expect(() =>
        defineUntypedApp({
          id: 'bad-app',
          main: './cli.js',
          activityModule: './activities.js',
          activities: { greet: { [field]: value } },
        }),
      ).toThrow(new RegExp(`${field} must be a nonempty string`));
    },
  );
});
