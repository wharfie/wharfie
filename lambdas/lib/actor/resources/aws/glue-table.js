'use strict';
const Glue = require('../../../glue');
const BaseResource = require('../base-resource');
const { EntityNotFoundException } = require('@aws-sdk/client-glue');

/**
 * @typedef GlueTableProperties
 * @property {string} databaseName -
 * @property {string | function(): string} catalogId -
 * @property {string} description -
 * @property {string} tableType -
 * @property {any} parameters -
 * @property {import('../../typedefs').WharfieTableColumn[]} partitionKeys -
 * @property {import('../../typedefs').WharfieTableColumn[]} columns -
 * @property {string} location -
 * @property {number} [numberOfBuckets] -
 * @property {boolean} [storedAsSubDirectories] -
 * @property {string} inputFormat -
 * @property {string} outputFormat -
 * @property {any} serdeInfo -
 * @property {boolean} [compressed] -
 * @property {string} [viewOriginalText] -
 * @property {string} [viewExpandedText] -
 * @property {any} [tags] -
 * @property {string | function(): string} [region] -
 */

/**
 * @typedef GlueTableOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {GlueTableProperties & import('../../typedefs').SharedDeploymentProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class GlueTable extends BaseResource {
  /**
   * @param {GlueTableOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, properties, dependsOn });
    this.glue = new Glue({});
    this.set(
      'arn',
      () =>
        `arn:aws:glue:${this.get('region')}:${this.get(
          'catalogId'
        )}:table/${this.get('databaseName')}/${this.name}`
    );
  }

  async _reconcileTags() {
    const { Tags } = await this.glue.getTags({
      ResourceArn: this.get('arn'),
    });
    /**
     * @type {Record<string, string>}
     */
    const tagsToAdd = {};
    /**
     * @type {string[]}
     */
    const tagsToRemove = [];
    Object.keys(this.get('tags')).forEach((tag) => {
      if (!Tags?.[tag]) {
        tagsToAdd[tag] = this.get('tags')[tag];
      }
    });
    Object.keys(Tags || {}).forEach((tag) => {
      if (!this.get('tags')[tag]) {
        tagsToRemove.push(tag);
      }
    });
    await Promise.all([
      Object.keys(tagsToAdd).length > 0
        ? this.glue.tagResource({
            ResourceArn: this.get('arn'),
            TagsToAdd: tagsToAdd,
          })
        : Promise.resolve(),
      tagsToRemove.length > 0
        ? this.glue.untagResource({
            ResourceArn: this.get('arn'),
            TagsToRemove: tagsToRemove,
          })
        : Promise.resolve(),
    ]);
  }

  async _reconcile() {
    const columns = (this.get('columns') || []).map(
      (/** @type {{ name: any; type: any; comment: any; }} */ column) => ({
        Name: column.name,
        Type: column.type,
        Comment: column.comment,
      })
    );
    const partitionKeys = (this.get('partitionKeys') || []).map(
      (/** @type {{ name: any; type: any; comment: any; }} */ column) => ({
        Name: column.name,
        Type: column.type,
        Comment: column.comment,
      })
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
        if (this.get('tags') && Object.keys(this.get('tags')).length > 0) {
          await this.glue.tagResource({
            ResourceArn: this.get('arn'),
            TagsToAdd: this.get('tags'),
          });
        }
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

module.exports = GlueTable;
