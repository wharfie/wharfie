import chalk from 'chalk';

export const displaySuccess = (...m) =>
  console.log(chalk.green.bold('OK'), ...m);
export const displayInfo = (...m) => console.log(chalk.white(...m));
export const displayWarning = (...m) => console.warn(chalk.yellow(...m));
export const displayFailure = (...m) => console.error(chalk.red(...m));
export const displayInstruction = (...m) => console.log(chalk.blue(...m));
