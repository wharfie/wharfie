/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { existsSync } from 'node:fs';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const INIT_COMMAND_IMPORT = '../../../cli/cmds/init.js';
const OUTPUT_IMPORT = '../../../cli/output/basic.js';
const EXTRACT_TEMPLATES_IMPORT = '../../../cli/assets/extract-templates.js';
const ORIGINAL_CWD = process.cwd();
const ORIGINAL_EXIT_CODE = process.exitCode;

/**
 * @param {{
 *   promptResult?: Record<string, any>,
 *   extractTemplatesImpl?: (...args: any[]) => Promise<any>
 * }} [options] - options.
 * @returns {Promise<{
 *   initCommand: import('commander').Command,
 *   prompt: any,
 *   extractTemplates: any,
 *   displayFailure: any,
 *   displayInfo: any,
 *   displaySuccess: any,
 * }>} - Result.
 */
async function loadInitCommand(options = {}) {
  jest.resetModules();

  const prompt = jest.fn(async () => options.promptResult || {});
  const extractTemplates = jest.fn(
    options.extractTemplatesImpl ||
      (async () => ({ mode: 'fs', filesWritten: 0 })),
  );
  const displayFailure = jest.fn();
  const displayInfo = jest.fn();
  const displaySuccess = jest.fn();

  await jest.unstable_mockModule('inquirer', () => ({
    default: { prompt },
  }));
  await jest.unstable_mockModule(OUTPUT_IMPORT, () => ({
    displayFailure,
    displayInfo,
    displaySuccess,
  }));
  await jest.unstable_mockModule(EXTRACT_TEMPLATES_IMPORT, () => ({
    extractTemplates,
  }));

  const mod = await import(INIT_COMMAND_IMPORT);

  return {
    initCommand: mod.default,
    prompt,
    extractTemplates,
    displayFailure,
    displayInfo,
    displaySuccess,
  };
}

describe('wharfie init command', () => {
  /** @type {string} */
  let tmpRoot;

  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-init-command-'),
    );
    process.chdir(tmpRoot);
    process.exitCode = undefined;
  });

  afterEach(async () => {
    process.chdir(ORIGINAL_CWD);
    process.exitCode = ORIGINAL_EXIT_CODE;
    jest.restoreAllMocks();
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  it('creates a normalized project scaffold without prompting when the project name is provided', async () => {
    const { initCommand, prompt, extractTemplates, displaySuccess } =
      await loadInitCommand();

    await initCommand.parseAsync(['My Project', '--no-examples'], {
      from: 'user',
    });

    const projectDir = path.join(tmpRoot, 'my_project');

    expect(prompt).not.toHaveBeenCalled();
    expect(extractTemplates).not.toHaveBeenCalled();
    expect(existsSync(path.join(projectDir, 'wharfie.yaml'))).toBe(true);
    expect(existsSync(path.join(projectDir, 'sources'))).toBe(true);
    expect(existsSync(path.join(projectDir, 'models'))).toBe(true);
    expect(displaySuccess).toHaveBeenCalledWith(
      expect.stringContaining('Project my_project initialized successfully!'),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it('prompts for a missing project name and extracts example templates by default', async () => {
    const { initCommand, prompt, extractTemplates } = await loadInitCommand({
      promptResult: { project_name: 'Prompt Project' },
      extractTemplatesImpl: async ({ destinationDir }) => {
        await fsp.writeFile(
          path.join(destinationDir, 'models', 'example.sql'),
          'select 1 as one;\n',
          'utf8',
        );
        return { mode: 'fs', filesWritten: 1 };
      },
    });

    await initCommand.parseAsync([], { from: 'user' });

    const projectDir = path.join(tmpRoot, 'prompt_project');

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(extractTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        destinationDir: expect.stringContaining(projectDir),
        diskSourceDir: expect.stringContaining(
          path.join('cli', 'project', 'project_structure_examples'),
        ),
      }),
    );
    await expect(
      fsp.readFile(path.join(projectDir, 'models', 'example.sql'), 'utf8'),
    ).resolves.toEqual('select 1 as one;\n');
    expect(process.exitCode).toBeUndefined();
  });

  it('reports invalid project names', async () => {
    const { initCommand, displayFailure, extractTemplates } =
      await loadInitCommand();

    await initCommand.parseAsync(['bad/project'], { from: 'user' });

    expect(displayFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Project name can only contain letters, numbers, spaces, and underscores.',
      }),
    );
    expect(extractTemplates).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('fails when the normalized project directory already exists', async () => {
    const projectDir = path.join(tmpRoot, 'existing_project');
    await fsp.mkdir(projectDir, { recursive: true });

    const { initCommand, displayFailure, prompt } = await loadInitCommand();

    await initCommand.parseAsync(['Existing Project'], { from: 'user' });

    expect(prompt).not.toHaveBeenCalled();
    expect(displayFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Directory already exists with name existing_project, please pick a different project name.',
      }),
    );
    expect(process.exitCode).toBe(1);
  });
});
