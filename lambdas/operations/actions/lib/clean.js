'use strict';

class Clean {
  /**
   * @typedef CleanOptions
   * @property {import('../../../lib/s3')} s3 - wharfie s3 resource
   * @property {import('../../../lib/glue')} glue - wharfie glue resource
   * @param {CleanOptions} options - options for Clean instance
   */
  constructor({ s3, glue }) {
    this.s3 = s3;
    this.glue = glue;
  }

  /**
   * @param {import('../../../typedefs').ResourceRecord} resource -
   */
  async cleanup_query_metadata(resource) {
    const dateOffset = 24 * 60 * 60 * 1000; // 24 hours
    const expirationDate = new Date();
    expirationDate.setTime(expirationDate.getTime() - dateOffset);
    const base_location = (
      resource.destination_properties.location || ''
    ).replace('/references/', '/');
    const { bucket, prefix } = this.s3.parseS3Uri(base_location);
    await this.s3.expireObjects(
      {
        Bucket: bucket,
        Prefix: `${prefix}query_metadata/`,
      },
      expirationDate
    );
  }

  /**
   * @param {import('../../../typedefs').ResourceRecord} resource -
   */
  async cleanup_data(resource) {
    const dateOffset = 24 * 60 * 60 * 1000; // 24 hours
    const expirationDate = new Date();
    expirationDate.setTime(expirationDate.getTime() - dateOffset);
    const databaseName = resource.destination_properties.databaseName;
    const tableName = resource.destination_properties.name;
    const partitionKeys = resource.destination_properties.partitionKeys;

    const base_location = (
      resource.destination_properties.location || ''
    ).replace('/references/', '/');

    if (!partitionKeys || partitionKeys.length === 0) {
      const { bucket, prefix } = this.s3.parseS3Uri(base_location);
      const prefixes = await this.s3.getCommonPrefixes({
        Bucket: bucket,
        Prefix: `${prefix}data/`,
      });
      const { Table: table } = await this.glue.getTable({
        DatabaseName: databaseName,
        Name: tableName,
      });
      if (
        !table ||
        !table.StorageDescriptor ||
        !table.StorageDescriptor.Location
      )
        throw new Error(`table does not exist ${databaseName}.${tableName}`);
      const { prefix: livePrefix } = this.s3.parseS3Uri(
        table.StorageDescriptor.Location
      );

      while (prefixes.length > 0) {
        const prefixChunk = prefixes.splice(0, 10);
        await Promise.all(
          prefixChunk.map((prefix) => {
            if (prefix.startsWith(livePrefix) && livePrefix)
              return Promise.resolve();
            return this.s3.expireObjects(
              {
                Bucket: bucket,
                Prefix: prefix,
              },
              expirationDate
            );
          })
        );
      }
      return;
    }

    const partitions = await this.glue.getPartitions({
      DatabaseName: databaseName,
      TableName: tableName,
    });
    /** @type {Object.<string, string | number>} */
    const partitionLookup = partitions.reduce((acc, partition) => {
      const key = partitionKeys
        .map(
          (/** @type {Object.<string, string | number>} */ key) =>
            `${key.Name}=${partition.partitionValues[key.Name]}/`
        )
        .join('');
      const { prefix } = this.s3.parseS3Uri(partition.location);
      // @ts-ignore
      acc[key] = prefix;
      return acc;
    }, {});

    const { bucket, prefix } = this.s3.parseS3Uri(base_location);
    const prefixes = await this.s3.getCommonPrefixes({
      Bucket: bucket,
      Prefix: `${prefix}data/`,
    });

    while (prefixes.length > 0) {
      const prefixChunk = prefixes.splice(0, 1);
      await Promise.all(
        prefixChunk.map(async (prefix) => {
          const partitions = await this.s3.findPartitions(
            bucket,
            prefix,
            partitionKeys
          );
          while (partitions.length > 0) {
            const partitionChunk = partitions.splice(0, 100);
            await Promise.all(
              partitionChunk.map(async (partition) => {
                const key = partitionKeys
                  .map(
                    (/** @type {Object.<string, string | number>} */ key) =>
                      `${key.Name}=${partition.partitionValues[key.Name]}/`
                  )
                  .join('');
                const current = partitionLookup[key];
                const { prefix } = this.s3.parseS3Uri(partition.location);
                if (prefix < current || !current) {
                  await this.s3.expireObjects(
                    {
                      Bucket: bucket,
                      Prefix: prefix,
                    },
                    expirationDate
                  );
                }
              })
            );
          }
        })
      );
    }
  }

  /**
   * @param {import('../../../typedefs').ResourceRecord} resource -
   */
  async cleanAll(resource) {
    await Promise.all([
      this.cleanup_query_metadata(resource),
      this.cleanup_data(resource),
    ]);
  }

  /**
   * @param {import('../../../typedefs').ResourceRecord} resource -
   * @param {import('../../../typedefs').QueryRecord} query -
   */
  async cleanupQueryOutput(resource, query) {
    const destinationDatabaseName =
      resource.destination_properties.databaseName;
    const destinationTableName = resource.destination_properties.name;

    const { Table: destinationTable } = await this.glue.getTable({
      DatabaseName: destinationDatabaseName,
      Name: destinationTableName,
    });
    if (
      !destinationTable ||
      !destinationTable.StorageDescriptor ||
      !destinationTable.StorageDescriptor.Location
    ) {
      return;
    }
    const location_segments =
      destinationTable.StorageDescriptor.Location.split('/');
    const base_location = location_segments
      .slice(0, location_segments.length - 2)
      .join('/');
    const queryManifestLocation = `${base_location}/query_metadata/${query.query_execution_id}-manifest.csv`;
    const { bucket: queryManifestBucket, prefix: queryManifestPrefix } =
      this.s3.parseS3Uri(queryManifestLocation);
    let body;
    try {
      body = await this.s3.getObject({
        Bucket: queryManifestBucket,
        Key: queryManifestPrefix,
      });
    } catch (error) {
      // @ts-ignore
      if (error.name === 'NoSuchKey') return;
      throw error;
    }
    const references = (body || '')
      .toString()
      .split('\n')
      .filter((r) => !!r)
      .map((reference) => {
        const { prefix } = this.s3.parseS3Uri(reference);
        return {
          Key: prefix,
        };
      });
    await this.s3.deleteObjects({
      Bucket: queryManifestBucket,
      Delete: {
        Objects: [
          ...references,
          {
            Key: queryManifestPrefix,
          },
        ],
      },
    });
  }

  /**
   * @param {import('../../../typedefs').ResourceRecord} resource -
   * @param {string} manifest_uri -
   */
  // @ts-ignore
  async cleanupManifest(resource, manifest_uri) {
    const { bucket, prefix } = this.s3.parseS3Uri(manifest_uri);
    /** @type {Array<string>} */
    let references = [];
    try {
      const body = await this.s3.getObject({
        Bucket: bucket,
        Key: prefix,
      });
      references = [...body.split('\n'), manifest_uri];
    } catch (error) {
      // @ts-ignore
      if (error.name === 'NoSuchKey') return;
    }

    /** @type {Object<string,Array<any>>} */
    const delete_ops = {};
    references.forEach((reference) => {
      if (!reference) return;
      const { bucket, prefix } = this.s3.parseS3Uri(reference);
      if (!delete_ops[bucket]) {
        delete_ops[bucket] = [];
      }
      delete_ops[bucket].push({ Key: prefix });
    });

    await Promise.all(
      Object.keys(delete_ops).map((bucket) => {
        return this.s3.deleteObjects({
          Bucket: bucket,
          Delete: {
            Objects: delete_ops[bucket],
          },
        });
      })
    );
  }
}

module.exports = Clean;
