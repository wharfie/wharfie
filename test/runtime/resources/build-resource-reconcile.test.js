/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';

import BuildResource from '../../../lambdas/lib/actor/resources/builds/build-resource.js';
import BuildResourceGroup from '../../../lambdas/lib/actor/resources/builds/build-resource-group.js';
import Reconcilable from '../../../lambdas/lib/actor/resources/reconcilable.js';

class DelayedBuildResource extends BuildResource {
  constructor() {
    super({
      name: 'delayed-build-resource',
      properties: {},
    });
    this.finished = false;
  }

  async _reconcile() {
    await new Promise((resolve) => setTimeout(resolve, 25));
    this.finished = true;
  }

  async _destroy() {}
}

class DelayedBuildResourceGroup extends BuildResourceGroup {
  constructor() {
    super({
      name: 'delayed-build-group',
      properties: {},
    });
    this.finished = false;
  }

  async _reconcile() {
    await new Promise((resolve) => setTimeout(resolve, 25));
    this.finished = true;
  }

  async _destroy() {}
}

describe('build resource reconcile lifecycle', () => {
  it('awaits BuildResource.reconcile until the resource is stable', async () => {
    const resource = new DelayedBuildResource();

    await resource.reconcile();

    expect(resource.finished).toBe(true);
    expect(resource.status).toBe(Reconcilable.Status.STABLE);
  });

  it('awaits BuildResourceGroup.reconcile until the resource is stable', async () => {
    const resource = new DelayedBuildResourceGroup();

    await resource.reconcile();

    expect(resource.finished).toBe(true);
    expect(resource.status).toBe(Reconcilable.Status.STABLE);
  });
});
