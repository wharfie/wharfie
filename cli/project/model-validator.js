// eslint-disable-next-line n/no-missing-import
import { Parser } from 'node-sql-parser/build/athena';
import chalk from 'chalk';

import Glue from '../../lambdas/lib/aws/glue.js';
import { WHARFIE_DEFAULT_ENVIRONMENT } from './constants.js';

const glue = new Glue({});
const parser = new Parser();

export class WharfieModelSQLError extends Error {}

/**
 * @param {import('./typedefs.js').Project} project -
 * @param {import('./typedefs.js').Environment} environment -
 * @returns {string} -
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
 * @param {import('./typedefs.js').Project} project -
 * @param {import('./typedefs.js').Environment} environment -
 * @returns {ValidationError[]} -s
 */
export function validateModelSql(modelSqls, project, environment) {
  /**
   * @type {ValidationError[]}
   */
  const errors = [];
  const projectDatabaseName = getDatabaseName(project, environment);
  Object.keys(modelSqls).forEach(async (modelSqlKey) => {
    const modelSql = modelSqls[modelSqlKey];
    /** @type {Array<{ DatabaseName: string | undefined, TableName: string | undefined }> | undefined} */
    let sqlReferences;
    try {
      const { tableList = [] } = parser.parse(modelSql);
      sqlReferences = tableList.map((tableref) => {
        const parts = tableref.split('::');
        return {
          DatabaseName: parts[1],
          TableName: parts[2],
        };
      });
    } catch (error) {
      const parserError =
        /** @type {{ location?: { start: { line: number, column: number }, end: { line: number, column: number } }, message?: string }} */ (
          error
        );
      if (!parserError.location) {
        errors.push(
          new WharfieModelSQLError(
            error instanceof Error ? error.message : String(error),
          ),
        );
        return;
      }
      const { start, end } = parserError.location;
      const queryLines = modelSql.split('\n');
      const errorLine = queryLines[start.line - 1] || '';
      const highlightedErrorLine =
        errorLine.substring(0, start.column - 1) +
        chalk.red(errorLine.substring(start.column - 1, end.column)) +
        errorLine.substring(end.column);
      errors.push(
        new WharfieModelSQLError(
          `${chalk.bgWhite.black(
            `Model::${modelSqlKey}`,
          )} is invalid SQL \n${chalk.bgGrey.bold.white(
            `Ln ${start.line}, Col ${start.column}`,
          )}  ${chalk.bold(highlightedErrorLine)} - ${parserError.message || 'Invalid SQL'}`,
        ),
      );
      return;
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
              (model) => model.name === TableName,
            );
            const projectSource = project.sources.find(
              /**
               * @param {import('./typedefs.js').Source} source - Project source candidate.
               * @returns {boolean} - Whether the source matches the referenced table.
               */
              (source) => source.name === TableName,
            );
            if (!projectModel && !projectSource) {
              errors.push(
                new WharfieModelSQLError(
                  `model (${modelSqlKey}) references table that does not exist ${DatabaseName}.${TableName}`,
                ),
              );
            }
          } else {
            errors.push(
              new WharfieModelSQLError(
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
        }
      }),
    );
  });
  return errors;
}
