const { Parser } = require('node-sql-parser/build/athena');
const chalk = require('chalk');

const { WHARFIE_DEFAULT_ENVIRONMENT } = require('./constants');
const Glue = require('../../lambdas/lib/glue');

const glue = new Glue({});
const parser = new Parser();

class WharfieModelSQLError extends Error {}

/**
 * @param {import('./typedefs').Project} project -
 * @param {import('./typedefs').Environment} environment -
 * @returns {String} -
 */
function getDatabaseName(project, environment) {
  return `${project.name}${
    environment.name === WHARFIE_DEFAULT_ENVIRONMENT
      ? ''
      : `-${environment.name}`
  }`.replace(/-/g, '_');
}

/**
 * @typedef ValidationError
 * @property {string} message -
 */

/**
 * @param {Object<string,string>} modelSqls -
 * @param {import('./typedefs').Project} project -
 * @param {import('./typedefs').Environment} environment -
 * @returns {ValidationError[]} -s
 */
function validateModelSql(modelSqls, project, environment) {
  /**
   * @type {ValidationError[]}
   */
  const errors = [];
  const projectDatabaseName = getDatabaseName(project, environment);
  Object.keys(modelSqls).forEach(async (modelSqlKey) => {
    const modelSql = modelSqls[modelSqlKey];
    let sqlReferences;
    try {
      const { tableList } = parser.parse(modelSql);
      sqlReferences = tableList.map((tableref) => {
        const parts = tableref.split('::');
        return {
          DatabaseName: parts[1],
          TableName: parts[2],
        };
      });
    } catch (error) {
      // @ts-ignore
      if (!error.location) errors.push(error);
      // @ts-ignore
      const { start, end } = error.location;
      const queryLines = modelSql.split('\n');
      const errorLine = queryLines[start.line - 1];
      const highlightedErrorLine =
        errorLine.substring(0, start.column - 1) +
        chalk.red(errorLine.substring(start.column - 1, end.column)) +
        errorLine.substring(end.column);

      errors.push(
        new WharfieModelSQLError(
          `${chalk.bgWhite.black(
            `Model::${modelSqlKey}`
          )} is invalid SQL \n${chalk.bgGrey.bold.white(
            `Ln ${start.line}, Col ${start.column}`
          )}  ${chalk.bold(highlightedErrorLine)}`
        )
      );
    }
    await Promise.all(
      (sqlReferences || []).map(async (sqlReference) => {
        const { DatabaseName, TableName } = sqlReference;
        try {
          await glue.getTable({
            DatabaseName: DatabaseName || projectDatabaseName,
            Name: TableName,
          });
        } catch (error) {
          if (error instanceof Glue.EntityNotFoundException) {
            const projectModel = project.models.find(
              (model) => model.name === TableName
            );
            const projectSource = project.sources.find(
              (model) => model.name === TableName
            );
            if (!projectModel || !projectSource) {
              errors.push(
                new WharfieModelSQLError(
                  `model (${modelSqlKey}) references table that does not exist ${DatabaseName}.${TableName}`
                )
              );
            }
          } else {
            // @ts-ignore
            errors.push(error);
          }
        }
      })
    );
  });
  return errors;
}

module.exports = {
  validateModelSql,
  WharfieModelSQLError,
};
