'use strict';
const BaseResource = require('../base-resource');
const { ResourceNotFoundException } = require('@aws-sdk/client-dynamodb');
const action_definitino_db = require('../../../dynamo/action-type-definition');

/**
 * @typedef ActionDefinitionRecordProperties
 * @property {import('../../../../typedefs').ActionDefinitionRecord | function(): import('../../../../typedefs').ActionDefinitionRecord} data -
 * @property {string} table_name -
 */

/**
 * @typedef ActionDefinitionRecordOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {ActionDefinitionRecordProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class ActionTypeDefinitionRecord extends BaseResource {
  /**
   * @param {ActionDefinitionRecordOptions} options -
   */
  constructor({ name, parent, status, dependsOn = [], properties }) {
    super({
      name,
      parent,
      status,
      dependsOn,
      properties,
    });
  }

  async _reconcile() {
    await action_definitino_db.putActionDefinition(
      this.get('data', {}),
      this.get('table_name')
    );
  }

  async _destroy() {
    try {
      await action_definitino_db.deleteActionDefinition(
        this.get('data', {}),
        this.get('table_name')
      );
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }
}

module.exports = ActionTypeDefinitionRecord;
