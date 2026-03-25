/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import EventEmitter from 'node:events';

import BaseResource from '../../../src/core/resources/base-resource.js';
import BaseResourceGroup from '../../../src/core/resources/base-resource-group.js';
import Reconcilable from '../../../src/core/resources/reconcilable.js';

class TestLeaf extends BaseResource {
  async _reconcile() {
    this._setUNSAFE('reconciled', true);
  }

  async _destroy() {}
}

class TestGroup extends BaseResourceGroup {
  /**
   * @param {string} parent - parent.
   * @returns {TestLeaf[]} - Result.
   */
  _defineGroupResources(parent) {
    return [
      new TestLeaf({
        name: 'child',
        parent,
        properties: {},
      }),
    ];
  }
}

/**
 * @returns {{
 *   calls: { putResource: string[], putResourceStatus: string[] },
 *   putResource: (resource: BaseResource) => Promise<void>,
 *   putResourceStatus: (resource: BaseResource) => Promise<void>,
 *   getResource: () => Promise<undefined>,
 *   getResourceStatus: () => Promise<undefined>,
 *   getResources: () => Promise<never[]>,
 *   deleteResource: () => Promise<void>,
 * }} - Result.
 */
function createStateStore() {
  const calls = {
    putResource: /** @type {string[]} */ ([]),
    putResourceStatus: /** @type {string[]} */ ([]),
  };

  return {
    calls,
    putResource: async (resource) => {
      calls.putResource.push(resource.getName());
    },
    putResourceStatus: async (resource) => {
      calls.putResourceStatus.push(resource.getName());
    },
    getResource: async () => undefined,
    getResourceStatus: async () => undefined,
    getResources: async () => [],
    deleteResource: async () => {},
  };
}

describe('resource scope isolation', () => {
  it('isolates state stores and telemetry emitters per resource tree', async () => {
    const storeA = createStateStore();
    const storeB = createStateStore();
    const emitterB = new EventEmitter();
    /** @type {string[]} */
    const eventsA = [];
    /** @type {string[]} */
    const eventsB = [];

    emitterB.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
      eventsB.push(`${event.constructor}:${event.name}:${event.status}`);
    });

    const groupA = new TestGroup({
      name: 'group-a',
      properties: {},
      runtime: {
        stateStore: storeA,
        telemetry: {
          emit(/** @type {string} */ eventName, /** @type {any} */ event) {
            if (eventName === Reconcilable.Events.WHARFIE_STATUS) {
              eventsA.push(
                `${event.constructor}:${event.name}:${event.status}`,
              );
            }
          },
        },
      },
    });
    const groupB = new TestGroup({
      name: 'group-b',
      properties: {},
      stateDB: storeB,
      emitter: emitterB,
    });

    const childA = groupA.getResource('child');
    const childB = groupB.getResource('child');

    expect(groupA.getStateDB()).toBe(storeA);
    expect(childA.getStateDB()).toBe(storeA);
    expect(groupB.getStateDB()).toBe(storeB);
    expect(childB.getStateDB()).toBe(storeB);

    expect(groupA.getEmitter()).toBe(childA.getEmitter());
    expect(groupB.getEmitter()).toBe(emitterB);
    expect(childB.getEmitter()).toBe(emitterB);

    await groupA.reconcile();
    await groupB.reconcile();

    expect(storeA.calls.putResourceStatus).toEqual(
      expect.arrayContaining(['group-a', 'group-a#child']),
    );
    expect(storeA.calls.putResource).toEqual(
      expect.arrayContaining(['group-a', 'group-a#child']),
    );
    expect(storeB.calls.putResourceStatus).toEqual(
      expect.arrayContaining(['group-b', 'group-b#child']),
    );
    expect(storeB.calls.putResource).toEqual(
      expect.arrayContaining(['group-b', 'group-b#child']),
    );

    expect(storeA.calls.putResourceStatus.join('|')).not.toContain('group-b');
    expect(storeA.calls.putResource.join('|')).not.toContain('group-b');
    expect(storeB.calls.putResourceStatus.join('|')).not.toContain('group-a');
    expect(storeB.calls.putResource.join('|')).not.toContain('group-a');

    expect(eventsA).toEqual(
      expect.arrayContaining([
        'TestGroup:group-a:UNPROVISIONED',
        'TestLeaf:child:UNPROVISIONED',
        'TestGroup:group-a:STABLE',
        'TestLeaf:child:STABLE',
      ]),
    );
    expect(eventsB).toEqual(
      expect.arrayContaining([
        'TestGroup:group-b:UNPROVISIONED',
        'TestLeaf:child:UNPROVISIONED',
        'TestGroup:group-b:STABLE',
        'TestLeaf:child:STABLE',
      ]),
    );
  });
});
