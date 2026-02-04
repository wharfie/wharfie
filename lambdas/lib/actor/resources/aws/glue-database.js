import Glue from '../../../glue.js';
import BaseResource from '../base-resource.js';
import { EntityNotFoundException } from '@aws-sdk/client-glue';

/**
 * @typedef GlueDatabaseProperties
 * @property {string} [databaseName] - databaseName.
 * @property {Record<string, string>} [tags] - tags.
 */

/**
 * @typedef GlueDatabaseOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {GlueDatabaseProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class GlueDatabase extends BaseResource {
  /**
   * @param {GlueDatabaseOptions} options - options.
   */
  constructor({ name, parent, status, dependsOn = [], properties }) {
    super({ name, parent, status, dependsOn, properties });
    this.glue = new Glue({});
  }

  async _reconcileTags() {
    const { Tags } = await this.glue.getTags({
      ResourceArn: this.get('arn'),
    });
    const currentTags = Tags || {};
    const desiredTags = this.get('tags') || {};

    const tagsToAdd = Object.entries(desiredTags).filter(
      ([key, value]) => currentTags[key] !== value,
    );
    const tagsToRemove = Object.keys(currentTags).filter(
      (key) => !desiredTags[key],
    );

    if (tagsToAdd.length > 0) {
      await this.glue.tagResource({
        ResourceArn: this.get('arn'),
        TagsToAdd: Object.fromEntries(tagsToAdd),
      });
    }
    if (tagsToRemove.length > 0) {
      await this.glue.untagResource({
        ResourceArn: this.get('arn'),
        TagsToRemove: tagsToRemove,
      });
    }
  }

  async _reconcile() {
    try {
      await this.glue.getDatabase({
        Name: this.get('databaseName', this.name),
      });
      this.set(
        'arn',
        `arn:aws:glue:${this.get('deployment').region}:${
          this.get('deployment').accountId
        }:database/${this.get('databaseName', this.name)}`,
      );
    } catch (error) {
      if (error instanceof EntityNotFoundException) {
        await this.glue.createDatabase({
          DatabaseInput: {
            Name: this.get('databaseName', this.name),
          },
        });
        this.set(
          'arn',
          `arn:aws:glue:${this.get('deployment').region}:${
            this.get('deployment').accountId
          }:database/${this.get('databaseName', this.name)}`,
        );
      } else {
        throw error;
      }
    }
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      await this.glue.deleteDatabase({
        Name: this.get('databaseName', this.name),
      });
    } catch (error) {
      if (!(error instanceof EntityNotFoundException)) {
        throw error;
      }
    }
  }
}

export default GlueDatabase;
