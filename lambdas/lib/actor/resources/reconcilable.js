'use strict';

const EventEmitter = require('events');

class ReconcilableEmitter extends EventEmitter {}

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
 * @typedef {('WHARFIE_STATUS'|'WHARFIE_ERROR')} EventEnum
 */

/**
 * @type {Object<EventEnum,EventEnum>}
 */
const Events = {
  WHARFIE_STATUS: 'WHARFIE_STATUS',
  WHARFIE_ERROR: 'WHARFIE_ERROR',
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

    this.setStatus(status);
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
    this.setStatus(Status.DESTROYING);
  }

  markForReconcile() {
    this.setStatus(Status.RECONCILING);
  }

  isDestroyed() {
    return this.status === Status.DESTROYED;
  }

  /**
   * @param {StatusEnum} status -
   */
  setStatus(status) {
    this.status = status;
    this.dispatchStatusEvent();
  }

  dispatchStatusEvent() {
    Reconcilable.Emitter.emit(Events.WHARFIE_STATUS, this.asEvent());
  }

  /**
   * @typedef ReconcilableEvent
   * @property {string} name -
   * @property {string} constructor -
   * @property {import('./reconcilable').Status} status -
   * @returns {ReconcilableEvent} -
   */
  asEvent() {
    return {
      name: this.name,
      constructor: this.constructor.name,
      status: this.status,
    };
  }

  async reconcile() {
    if ([Status.DESTROYING].includes(this.status)) {
      await this.destroy();
      return;
    }
    if (
      !process.env?.WHARFIE_FORCE_RECONCILIATION &&
      [Status.STABLE].includes(this.status)
    ) {
      return;
    }
    let reconcile_attempts = 0;
    let last_error = null;
    this.setStatus(Status.RECONCILING);
    await this._pre_reconcile();
    this.reconcile_start = Date.now();
    while (reconcile_attempts < this._MAX_RETRIES) {
      try {
        if (this.dependsOn.find((dependency) => !dependency.isStable())) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
        await this._reconcile();
        this.reconcile_end = Date.now();
        this.setStatus(Status.STABLE);
        break;
      } catch (error) {
        // console.trace(error)
        Reconcilable.Emitter.emit(Events.WHARFIE_ERROR, {
          name: this.name,
          constructor: this.constructor.name,
          error,
        });
        // @ts-ignore
        this._reconcileErrors.push(error);
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

    if (!this.isStable()) throw last_error;
    this._post_reconcile();
  }

  async _destroy() {
    throw new Error('Not Implemented');
  }

  async _pre_destroy() {}

  async _post_destroy() {}

  async destroy() {
    this.setStatus(Status.DESTROYING);
    await this._pre_destroy();
    this.destroy_start = Date.now();
    let destroy_attempts = 0;
    let last_error = null;
    while (destroy_attempts < this._MAX_RETRIES) {
      try {
        await this._destroy();
        this.destroy_end = Date.now();
        this.setStatus(Status.DESTROYED);
        break;
      } catch (error) {
        Reconcilable.Emitter.emit(Events.WHARFIE_ERROR, {
          name: this.name,
          constructor: this.constructor.name,
          error,
        });
        // @ts-ignore
        this._destroyErrors.push(error);
        // if (
        //   // @ts-ignore
        //   error?.name !== last_error?.name ||
        //   // @ts-ignore
        //   error?.message !== last_error?.message
        // ) {
        //   destroy_attempts = 0;
        // }
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
    await this._post_destroy();
  }
}

Reconcilable.Emitter = new ReconcilableEmitter();

Reconcilable.Status = Status;
Reconcilable.Events = Events;

module.exports = Reconcilable;
