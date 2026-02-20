import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import inquirer from 'inquirer';

import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../output/basic.js';
import { extractTemplates } from '../assets/extract-templates.js';

const PROJECT_NAME_RE = /^[a-zA-Z0-9_ ]*$/;

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeProjectName(raw) {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Project name is required');

  if (!PROJECT_NAME_RE.test(trimmed)) {
    throw new Error(
      'Project name can only contain letters, numbers, spaces, and underscores.',
    );
  }

  return trimmed.toLowerCase().replace(/ /g, '_');
}

/**
 * @param {{ projectName?: string | undefined, includeExamples?: boolean | undefined }} options
 * @returns {Promise<{ projectName: string, includeExamples: boolean }>}
 */
async function resolveInitInputs(options) {
  /** @type {string | undefined} */
  let projectName = options.projectName;
  /** @type {boolean | undefined} */
  let includeExamples = options.includeExamples;

  // If any inputs are missing, prompt.
  if (!projectName || includeExamples == null) {
    /** @type {{ project_name: string, include_examples: boolean }} */
    // @ts-ignore - inquirer has weak JS typings under ESM
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'project_name',
        message: 'What is the name of your project?',
        when: () => !projectName,
      },
      {
        type: 'confirm',
        name: 'include_examples',
        message: 'Include examples in your project?',
        default: true,
        when: () => includeExamples == null,
      },
    ]);

    if (!projectName) projectName = answers.project_name;
    if (includeExamples == null) includeExamples = answers.include_examples;
  }

  return {
    projectName: normalizeProjectName(projectName),
    includeExamples: includeExamples !== false,
  };
}

/**
 * Initializes a new Wharfie project directory.
 *
 * NOTE: When running from a SEA binary, templates are embedded as SEA assets
 * and extracted at runtime.
 *
 * @param {{ projectName?: string | undefined, includeExamples?: boolean | undefined }} options
 * @returns {Promise<void>}
 */
async function initProject(options) {
  const { projectName, includeExamples } = await resolveInitInputs(options);

  const projectDir = path.join(process.cwd(), projectName);

  if (fs.existsSync(projectDir)) {
    throw new Error(
      `Directory already exists with name ${projectName}, please pick a different project name.`,
    );
  }

  displayInfo(`Initializing project ${projectName}...`);
  await fsp.mkdir(projectDir, { recursive: false });

  await Promise.all([
    fsp.writeFile(path.join(projectDir, 'wharfie.yaml'), ''),
    fsp.mkdir(path.join(projectDir, 'sources')),
    fsp.mkdir(path.join(projectDir, 'models')),
  ]);

  if (includeExamples) {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const diskTemplatesDir = path.resolve(
      __dirname,
      '..',
      'project',
      'project_structure_examples',
    );

    await extractTemplates({
      destinationDir: projectDir,
      diskSourceDir: diskTemplatesDir,
    });
  }

  displaySuccess(
    `Project ${projectName} initialized successfully!\n\n` +
      `Run 'cd ${projectName}' and then explore your models/sources.`,
  );
}

const initCommand = new Command('init')
  .description('Initialize a new Wharfie project directory')
  .argument('[project_name]', 'Project name (otherwise prompt)')
  .option('--no-examples', 'Do not include example models/sources')
  .action(async (projectName, cmd) => {
    try {
      await initProject({
        projectName: typeof projectName === 'string' ? projectName : undefined,
        includeExamples: cmd.examples,
      });
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default initCommand;
