'use strict';

/**
 * @typedef {('DESTROYED'|'DESTROYING'|'STABLE'|'RECONCILING'|'UNPROVISIONED')} StatusEnum
 */

/**
 * @type {Object<StatusEnum,StatusEnum>}
 */
const Status = {
  DESTROYED: 'DESTROYED',
  DESTROYING: 'DESTROYING',
  STABLE: 'STABLE',
  RECONCILING: 'RECONCILING',
  UNPROVISIONED: 'UNPROVISIONED',
  DRIFTED: 'DRIFTED',
};
/**
 * @typedef ReconcilableOptions
 * @property {string} name -
 * @property {StatusEnum} [status] -
 * @property {Reconcilable[]} [dependsOn] -
 */

class Reconcilable {
  /**
   * @param {ReconcilableOptions} options - Reconcilable Class Options
   */
  constructor({ name, status = Status.UNPROVISIONED, dependsOn = [] }) {
    if (!name) {
      throw new Error(`${this.constructor.name} requires a name`);
    }
    this.status = status;
    this.name = name;
    this.dependsOn = dependsOn;
    this._MAX_RETRIES = 10;
    this._MAX_RETRY_TIMEOUT_SECONDS = 10;
    /**
     * @type {Error[]}
     */
    this._reconcileErrors = [];
    /**
     * @type {Error[]}
     */
    this._destroyErrors = [];
  }

  async _reconcile() {
    throw new Error('Not Implemented');
  }

  async _pre_reconcile() {}

  async _post_reconcile() {}

  isStable() {
    return this.status === Status.STABLE;
  }

  markForDestruction() {
    if (this.status === Status.DESTROYED) {
      return;
    }
    this.status = Status.DESTROYING;
  }

  markForReconcile() {
    this.status = Status.RECONCILING;
  }

  isDestroyed() {
    return this.status === Status.DESTROYED;
  }

  async reconcile() {
    if ([Status.DESTROYING].includes(this.status)) {
      await this.destroy();
      return;
    }
    if (
      !process.env?.WHARFIE_FORCE_RECONCILIATION &&
      [Status.STABLE].includes(this.status)
    )
      return;
    let reconcile_attempts = 0;
    let last_error = null;
    this.status = Status.RECONCILING;
    await this._pre_reconcile();
    this.reconcile_start = Date.now();
    while (reconcile_attempts < this._MAX_RETRIES) {
      try {
        if (this.dependsOn.find((dependency) => !dependency.isStable())) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          continue;
        }
        await this._reconcile();
        this.status = Status.STABLE;
        break;
      } catch (error) {
        console.trace(error);
        // @ts-ignore
        this._reconcileErrors.push(error);
        if (
          // @ts-ignore
          error?.name !== last_error?.name ||
          // @ts-ignore
          error?.message !== last_error?.message
        ) {
          reconcile_attempts = 0;
        }
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.floor(
              Math.random() *
                Math.min(
                  this._MAX_RETRY_TIMEOUT_SECONDS,
                  1 * Math.pow(2, reconcile_attempts)
                )
            ) * 1000
          )
        );
        reconcile_attempts++;
        last_error = error;
      }
    }
    this.reconcile_end = Date.now();

    console.log(
      `${this.constructor.name}::${this.name} reconciled in ${
        this.reconcile_end - this.reconcile_start
      }`
    );
    if (!this.isStable()) throw last_error;
    this._post_reconcile();
  }

  async _destroy() {
    throw new Error('Not Implemented');
  }

  async _pre_destroy() {}

  async _post_destroy() {}

  async destroy() {
    this.status = Status.DESTROYING;
    await this._pre_destroy();
    this.destroy_start = Date.now();
    let destroy_attempts = 0;
    let last_error = null;
    while (destroy_attempts < this._MAX_RETRIES) {
      try {
        await this._destroy();
        this.status = Status.DESTROYED;
        break;
      } catch (error) {
        // @ts-ignore
        this._destroyErrors.push(error);
        if (
          // @ts-ignore
          error?.name !== last_error?.name ||
          // @ts-ignore
          error?.message !== last_error?.message
        ) {
          destroy_attempts = 0;
        }
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.floor(
              Math.random() *
                Math.min(
                  this._MAX_RETRY_TIMEOUT_SECONDS,
                  1 * Math.pow(2, destroy_attempts)
                )
            ) * 1000
          )
        );
        destroy_attempts++;
        last_error = error;
      }
    }
    if (!this.isDestroyed()) throw last_error;
    this.destroy_end = Date.now();
    await this._post_destroy();
  }
}

Reconcilable.Status = Status;

module.exports = Reconcilable;
