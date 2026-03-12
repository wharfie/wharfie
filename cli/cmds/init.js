import { Command } from 'commander';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { existsSync, promises as fsp } from 'node:fs';
import inquirer from 'inquirer';

import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../output/basic.js';
import { extractTemplates } from '../assets/extract-templates.js';

// eslint-disable-next-line import/no-named-as-default-member
const prompt = inquirer.prompt.bind(inquirer);
const PROJECT_NAME_RE = /^[a-zA-Z0-9_ ]*$/;

/**
 * @typedef InitProjectOptions
 * @property {string} [projectName] - Project name supplied by the user.
 * @property {boolean} [includeExamples] - Whether example models/sources should be included.
 */

/**
 * @typedef InitProjectDependencies
 * @property {string} [cwd] - Working directory used to create the project.
 * @property {(questions: import('inquirer').QuestionCollection) => Promise<{ project_name: string, include_examples: boolean }>} [promptFn] - Prompt implementation.
 * @property {typeof extractTemplates} [extractTemplatesFn] - Template extractor.
 * @property {{ mkdir: typeof fsp.mkdir, writeFile: typeof fsp.writeFile, rm: typeof fsp.rm }} [fsModule] - fs promises helpers.
 * @property {(message: unknown) => void} [infoReporter] - Informational reporter.
 * @property {(message: unknown) => void} [successReporter] - Success reporter.
 */

/**
 * @param {string} raw - Raw project name input.
 * @returns {string} - Normalized project directory name.
 */
export function normalizeProjectName(raw) {
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
 * @param {InitProjectOptions} options - Requested init options.
 * @param {Pick<InitProjectDependencies, 'promptFn'>} [dependencies] - Prompt test hooks.
 * @returns {Promise<{ projectName: string, includeExamples: boolean }>} - Resolved init inputs.
 */
export async function resolveInitInputs(options, dependencies = {}) {
  const { promptFn = prompt } = dependencies;

  /** @type {string | undefined} */
  let projectName = options.projectName;
  /** @type {boolean | undefined} */
  let includeExamples = options.includeExamples;

  if (!projectName || includeExamples == null) {
    /** @type {{ project_name: string, include_examples: boolean }} */
    // @ts-ignore - inquirer has weak JS typings under ESM.
    const answers = await promptFn([
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
 * @param {InitProjectOptions} options - Requested init options.
 * @param {InitProjectDependencies} [dependencies] - Test hooks.
 * @returns {Promise<void>} - Resolves when the project has been created.
 */
export async function initProject(options, dependencies = {}) {
  const {
    cwd = process.cwd(),
    promptFn = prompt,
    extractTemplatesFn = extractTemplates,
    fsModule = fsp,
    infoReporter = displayInfo,
    successReporter = displaySuccess,
  } = dependencies;
  const { projectName, includeExamples } = await resolveInitInputs(options, {
    promptFn,
  });

  const projectDir = path.join(cwd, projectName);

  if (existsSync(projectDir)) {
    throw new Error(
      `Directory already exists with name ${projectName}, please pick a different project name.`,
    );
  }

  infoReporter(`Initializing project ${projectName}...`);

  let createdProjectDir = false;
  try {
    await fsModule.mkdir(projectDir, { recursive: false });
    createdProjectDir = true;

    await fsModule.writeFile(path.join(projectDir, 'wharfie.yaml'), '');
    await fsModule.mkdir(path.join(projectDir, 'sources'));
    await fsModule.mkdir(path.join(projectDir, 'models'));

    if (includeExamples) {
      const __dirname = path.dirname(fileURLToPath(import.meta.url));
      const diskTemplatesDir = path.resolve(
        __dirname,
        '..',
        'project',
        'project_structure_examples',
      );

      await extractTemplatesFn({
        destinationDir: projectDir,
        diskSourceDir: diskTemplatesDir,
      });
    }
  } catch (err) {
    if (createdProjectDir) {
      try {
        await fsModule.rm(projectDir, { recursive: true, force: true });
      } catch {
        // Best-effort rollback only. Preserve the original error below.
      }
    }
    throw err;
  }

  successReporter(
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
