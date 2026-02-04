import Glue from '../../../glue.js';
import BaseResource from '../base-resource.js';
import { EntityNotFoundException } from '@aws-sdk/client-glue';

/**
 * @typedef GlueTableProperties
 * @property {string} databaseName - databaseName.
 * @property {string | function(): string} catalogId - catalogId.
 * @property {string} description - description.
 * @property {string} tableType - tableType.
 * @property {any} parameters - parameters.
 * @property {import('../../typedefs.js').WharfieTableColumn[]} partitionKeys - partitionKeys.
 * @property {import('../../typedefs.js').WharfieTableColumn[]} columns - columns.
 * @property {string | function(): string} location - location.
 * @property {number} [numberOfBuckets] - numberOfBuckets.
 * @property {boolean} [storedAsSubDirectories] - storedAsSubDirectories.
 * @property {string} inputFormat - inputFormat.
 * @property {string} outputFormat - outputFormat.
 * @property {any} serdeInfo - serdeInfo.
 * @property {boolean} [compressed] - compressed.
 * @property {string} [viewOriginalText] - viewOriginalText.
 * @property {string} [viewExpandedText] - viewExpandedText.
 * @property {Record<string, string>} [tags] - tags.
 * @property {string | function(): string} [region] - region.
 */

/**
 * @typedef GlueTableOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {GlueTableProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class GlueTable extends BaseResource {
  /**
   * @param {GlueTableOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, properties, dependsOn });
    this.glue = new Glue({});
    this.set(
      'arn',
      () =>
        `arn:aws:glue:${this.get('region')}:${this.get(
          'catalogId',
        )}:table/${this.get('databaseName')}/${this.name}`,
    );
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
    const columns = (this.get('columns') || []).map(
      (/** @type {{ name: any; type: any; comment: any; }} */ column) => ({
        Name: column.name,
        Type: column.type,
        Comment: column.comment,
      }),
    );
    const partitionKeys = (this.get('partitionKeys') || []).map(
      (/** @type {{ name: any; type: any; comment: any; }} */ column) => ({
        Name: column.name,
        Type: column.type,
        Comment: column.comment,
      }),
    );
    try {
      const { Table } = await this.glue.getTable({
        CatalogId: this.get('catalogId'),
        DatabaseName: this.get('databaseName'),
        Name: this.name,
      });
      if (
        Table?.Description !== this.get('description') ||
        Table?.TableType !== this.get('tableType') ||
        Table?.Parameters !== this.get('parameters') ||
        Table?.PartitionKeys !== partitionKeys ||
        Table?.StorageDescriptor?.Columns !== columns ||
        Table?.StorageDescriptor?.Location !== this.get('location') ||
        Table?.StorageDescriptor?.NumberOfBuckets !==
          this.get('numberOfBuckets') ||
        Table?.StorageDescriptor?.StoredAsSubDirectories !==
          this.get('storedAsSubDirectories') ||
        Table?.StorageDescriptor?.SerdeInfo !== this.get('serdeInfo') ||
        Table?.StorageDescriptor?.Compressed !== this.get('compressed') ||
        Table?.ViewOriginalText !== this.get('viewOriginalText') ||
        Table?.ViewExpandedText !== this.get('viewExpandedText')
      ) {
        await this.glue.updateTable({
          CatalogId: this.get('catalogId'),
          DatabaseName: this.get('databaseName'),
          TableInput: {
            Name: this.name,
            Description: this.get('description'),
            TableType: this.get('tableType'),
            Parameters: this.get('parameters'),
            PartitionKeys: partitionKeys,
            StorageDescriptor: {
              Location: this.get('location'),
              Columns: columns,
              NumberOfBuckets: this.get('numberOfBuckets'),
              StoredAsSubDirectories: this.get('storedAsSubDirectories'),
              SerdeInfo: this.get('serdeInfo'),
              Compressed: this.get('compressed'),
              InputFormat: this.get('inputFormat'),
              OutputFormat: this.get('outputFormat'),
            },
            ViewOriginalText: this.get('viewOriginalText'),
            ViewExpandedText: this.get('viewExpandedText'),
          },
        });
      }
    } catch (error) {
      if (error instanceof EntityNotFoundException) {
        await this.glue.createTable({
          CatalogId: this.get('catalogId'),
          DatabaseName: this.get('databaseName'),
          TableInput: {
            Name: this.name,
            Description: this.get('description'),
            TableType: this.get('tableType'),
            Parameters: this.get('parameters'),
            PartitionKeys: partitionKeys,
            StorageDescriptor: {
              Location: this.get('location'),
              Columns: columns,
              NumberOfBuckets: this.get('numberOfBuckets'),
              StoredAsSubDirectories: this.get('storedAsSubDirectories'),
              SerdeInfo: this.get('serdeInfo'),
              Compressed: this.get('compressed'),
              InputFormat: this.get('inputFormat'),
              OutputFormat: this.get('outputFormat'),
            },
            ViewOriginalText: this.get('viewOriginalText'),
            ViewExpandedText: this.get('viewExpandedText'),
          },
        });
      } else {
        throw error;
      }
    }
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      await this.glue.deleteTable({
        CatalogId: this.get('catalogId'),
        DatabaseName: this.get('databaseName'),
        Name: this.name,
      });
    } catch (error) {
      // @ts-ignore
      if (!(error instanceof EntityNotFoundException)) {
        throw error;
      }
    }
  }
}

export default GlueTable;
