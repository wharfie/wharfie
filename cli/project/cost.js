import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getDatabaseName } = require('./names');

const Athena = require('../../lambdas/lib/athena').default;
const S3 = require('../../lambdas/lib/s3').default;
const Glue = require('../../lambdas/lib/glue').default;
const s3 = new S3();
const athena = new Athena({});
const glue = new Glue({});

/**
 * @typedef CostEstimate
 * @property {number} size -
 * @property {string} name -
 * @property {string} type -
 * @property {number} monthly_cost_estimate -
 */
class ProjectCostEstimator {
  /**
   * @typedef ProjectCostEstimatorOptions
   * @property {import('./typedefs').Project} project -
   * @property {import('./typedefs').Environment} environment -
   */

  /**
   * @param {ProjectCostEstimatorOptions} options -
   */
  constructor({ project, environment }) {
    this.project = project;
    this.environment = environment;
    this.currencyFormatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    });
    this.ATHENA_USD_COST_PER_TB = 5;
    this.TB = 1024 * 1024 * 1024 * 1024;
    this.MONTHLY_HOURS = 60 * 24 * 30;

    /** @type {Object<string,CostEstimate>} */
    this.costs = {};
    this.projectDatabaseName = getDatabaseName(project, environment);
  }

  /**
   *  @param {string} sql -
   *  @returns {string} -
   */
  applySQLTemplating(sql) {
    return sql.replace(/\${([^}]+)}/g, (match) => {
      switch (match) {
        case '${db}':
        case '${database}':
          return this.projectDatabaseName;
        default:
          return match;
      }
    });
  }

  /**
   *  @param {import('./typedefs').Model} model -
   *  @returns {Promise<CostEstimate>} -
   */
  async modelCost(model) {
    if (this.costs[`${this.projectDatabaseName}.${model.name}`]) {
      return this.costs[`${this.projectDatabaseName}.${model.name}`];
    }
    const { sources: sqlReferences } = athena.extractSources(
      this.applySQLTemplating(model.sql),
    );
    const totalRefSize =
      (
        await Promise.all(
          sqlReferences.map(async (sqlReference) => {
            if (
              this.costs[
                `${sqlReference.DatabaseName}.${sqlReference.TableName}`
              ]
            ) {
              return this.costs[
                `${sqlReference.DatabaseName}.${sqlReference.TableName}`
              ].size;
            }
            try {
              const { Table } = await glue.getTable({
                DatabaseName:
                  sqlReference.DatabaseName || this.projectDatabaseName,
                Name: sqlReference.TableName,
              });
              if (!Table?.StorageDescriptor?.Location)
                throw new Error('No location');
              const { bucket, prefix } = s3.parseS3Uri(
                Table?.StorageDescriptor?.Location,
              );
              const region = await s3.findBucketRegion({
                Bucket: bucket,
              });
              return await s3.getPrefixByteSize(
                {
                  Bucket: bucket,
                  Prefix: prefix,
                },
                region,
              );
            } catch (error) {
              // @ts-ignore
              if (error.__type === 'EntityNotFoundException') {
                const projectModel = this.project.models.find(
                  (model) => model.name === sqlReference.TableName,
                );
                const projectSource = this.project.sources.find(
                  (model) => model.name === sqlReference.TableName,
                );
                if (projectModel) {
                  return (await this.modelCost(projectModel)).size;
                } else if (projectSource) {
                  return (await this.sourceCost(projectSource)).size;
                }
              } else {
                throw error;
              }
            }
          }),
        )
      ).reduce((acc, size) => (acc || 0) + (size || 0), 0) || 0;

    const monthly_cost_number =
      (((this.MONTHLY_HOURS / model.service_level_agreement.freshness) *
        totalRefSize) /
        this.TB) *
      this.ATHENA_USD_COST_PER_TB;

    this.costs[`${this.projectDatabaseName}.${model.name}`] = {
      size: totalRefSize,
      name: model.name,
      monthly_cost_estimate: monthly_cost_number,
      type: 'model',
    };
    return this.costs[`${this.projectDatabaseName}.${model.name}`];
  }

  /**
   *  @param {import('./typedefs').Source} source -
   *  @returns {Promise<CostEstimate>} -
   */
  async sourceCost(source) {
    if (this.costs[`${this.projectDatabaseName}.${source.name}`]) {
      return this.costs[`${this.projectDatabaseName}.${source.name}`];
    }
    const { bucket, prefix } = s3.parseS3Uri(source.input_location.path);
    const region = await s3.findBucketRegion({
      Bucket: bucket,
    });
    const size = await s3.getPrefixByteSize(
      {
        Bucket: bucket,
        Prefix: prefix,
      },
      region,
    );
    const monthly_cost_number =
      (((this.MONTHLY_HOURS / source.service_level_agreement.freshness) *
        size) /
        this.TB) *
      this.ATHENA_USD_COST_PER_TB;

    this.costs[`${this.projectDatabaseName}.${source.name}`] = {
      size,
      name: source.name,
      monthly_cost_estimate: monthly_cost_number,
      type: 'source',
    };
    return this.costs[`${this.projectDatabaseName}.${source.name}`];
  }

  /**
   *  @returns {Promise<CostEstimate[]>} -
   */
  async calculateProjectCost() {
    await Promise.all(this.project.sources.map(this.sourceCost.bind(this)));
    await Promise.all(this.project.models.map(this.modelCost.bind(this)));
    return Object.values(this.costs);
  }
}

module.exports = ProjectCostEstimator;
