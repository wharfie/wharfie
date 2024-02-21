'use strict';

const inquirer = require('inquirer');
const path = require('path');
const fs = require('fs/promises');
const _fs = require('fs');

const { displayFailure, displayInfo, displaySuccess } = require('../../output');
const re = /^[a-zA-Z0-9_ ]*$/;

const init = async () => {
  const answers = await new Promise((resolve, reject) => {
    inquirer
      .prompt([
        {
          type: 'input',
          name: 'project_name',
          message: `what is the name of your project?`,
          validate: (input) => {
            const valid = re.test(input);
            if (!valid)
              displayFailure(
                'project name can only contain letters, numbers, spaces, and underscores'
              );
            return valid;
          },
        },
        {
          type: 'confirm',
          name: 'include_examples',
          message: `include examples in your project?`,
          default: true,
        },
      ])
      .then(resolve)
      .catch(reject);
  });
  answers.project_name = answers.project_name.toLowerCase().replace(/ /g, '_');
  const project_dir = path.join(process.cwd(), answers.project_name);
  if (_fs.existsSync(project_dir)) {
    throw new Error(
      `directory already exists with name ${answers.project_name}, please pick a different project name`
    );
  }
  displayInfo(`initializing project ${answers.project_name}...`);
  await fs.mkdir(project_dir);
  await Promise.all([
    fs.writeFile(path.join(project_dir, 'wharfie.yaml'), ''),
    fs.mkdir(path.join(project_dir, 'sources')),
    fs.mkdir(path.join(project_dir, 'models')),
  ]);

  if (answers.include_examples) {
    await fs.cp(
      path.join(__dirname, '..', '..', 'project', 'project_structure_examples'),
      project_dir,
      { recursive: true }
    );
  }

  displaySuccess(
    `project ${answers.project_name} initialized successfully! \n\n'cd ${answers.project_name}' and 'wharfie project apply' to get running`
  );
};

exports.command = 'init';
exports.desc = 'init wharfie project';
exports.builder = (yargs) => {};
exports.handler = async function () {
  try {
    await init();
  } catch (err) {
    displayFailure(err);
  }
};
