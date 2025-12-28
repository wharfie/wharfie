import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const { Command } = require('commander');
const inquirer = require('inquirer');
const path = require('path');
const fs = require('fs/promises');
const _fs = require('fs');
const {
  displayFailure,
  displayInfo,
  displaySuccess,
} = require('../../output/basic');
const { handleError } = require('../../output/error');

const re = /^[a-zA-Z0-9_ ]*$/;

/**
 * Initializes a new Wharfie project directory.
 * @returns {Promise<void>}
 */
const init = async () => {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'project_name',
      message: 'What is the name of your project?',
      validate: (input) => {
        const valid = re.test(input);
        if (!valid) {
          displayFailure(
            'Project name can only contain letters, numbers, spaces, and underscores.',
          );
        }
        return valid;
      },
    },
    {
      type: 'confirm',
      name: 'include_examples',
      message: 'Include examples in your project?',
      default: true,
    },
  ]);

  answers.project_name = answers.project_name.toLowerCase().replace(/ /g, '_');
  const projectDir = path.join(process.cwd(), answers.project_name);

  if (_fs.existsSync(projectDir)) {
    throw new Error(
      `Directory already exists with name ${answers.project_name}, please pick a different project name.`,
    );
  }

  displayInfo(`Initializing project ${answers.project_name}...`);
  await fs.mkdir(projectDir);
  await Promise.all([
    fs.writeFile(path.join(projectDir, 'wharfie.yaml'), ''),
    fs.mkdir(path.join(projectDir, 'sources')),
    fs.mkdir(path.join(projectDir, 'models')),
  ]);

  if (answers.include_examples) {
    await fs.cp(
      path.join(__dirname, '..', '..', 'project', 'project_structure_examples'),
      projectDir,
      { recursive: true },
    );
  }

  displaySuccess(
    `Project ${answers.project_name} initialized successfully!\n\n` +
      `Run 'cd ${answers.project_name}' and 'wharfie project apply' to get started.`,
  );
};

const initCommand = new Command('init')
  .description('Initialize new Wharfie project directory')
  .action(async () => {
    try {
      await init();
    } catch (err) {
      handleError(err);
    }
  });

module.exports = initCommand;
