import chalk from 'chalk';

/**
 * @param {...unknown} m - Message parts.
 * @returns {void}
 */
export const displaySuccess = (...m) =>
  console.log(chalk.green.bold('OK'), ...m);

/**
 * @param {...unknown} m - Message parts.
 * @returns {void}
 */
export const displayInfo = (...m) => console.log(chalk.white(...m));

/**
 * @param {...unknown} m - Message parts.
 * @returns {void}
 */
export const displayWarning = (...m) => console.warn(chalk.yellow(...m));

/**
 * @param {...unknown} m - Message parts.
 * @returns {void}
 */
export const displayFailure = (...m) => console.error(chalk.red(...m));

/**
 * @param {...unknown} m - Message parts.
 * @returns {void}
 */
export const displayInstruction = (...m) => console.log(chalk.blue(...m));
