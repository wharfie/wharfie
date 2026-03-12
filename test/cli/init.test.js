/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { initProject } from '../../cli/cmds/init.js';

describe('wharfie init', () => {
  /** @type {string} */
  let tempDir;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wharfie-init-'));
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
    process.exitCode = undefined;
  });

  it('creates a project without examples when requested non-interactively', async () => {
    await initProject(
      {
        projectName: 'My Project',
        includeExamples: false,
      },
      {
        cwd: tempDir,
        infoReporter: () => {},
        successReporter: () => {},
      },
    );

    await expect(
      fsp.readFile(path.join(tempDir, 'my_project', 'wharfie.yaml'), 'utf8'),
    ).resolves.toBe('');
    await expect(
      fsp.stat(path.join(tempDir, 'my_project', 'sources')),
    ).resolves.toBeDefined();
    await expect(
      fsp.stat(path.join(tempDir, 'my_project', 'models')),
    ).resolves.toBeDefined();
  });

  it('extracts examples when requested non-interactively', async () => {
    /** @type {import('../../cli/assets/extract-templates.js').extractTemplates} */
    const extractTemplatesImpl = async ({ destinationDir }) => {
      await fsp.writeFile(
        path.join(destinationDir, 'models', 'example.sql'),
        'select 1;\n',
      );
      await fsp.writeFile(
        path.join(destinationDir, 'sources', 'example.yaml'),
        'name: example\n',
      );
      return { mode: 'fs', filesWritten: 2 };
    };
    const extractTemplatesFn = jest.fn(extractTemplatesImpl);

    await initProject(
      {
        projectName: 'Examples Project',
        includeExamples: true,
      },
      {
        cwd: tempDir,
        extractTemplatesFn,
        infoReporter: () => {},
        successReporter: () => {},
      },
    );

    expect(extractTemplatesFn).toHaveBeenCalledTimes(1);
    await expect(
      fsp.readFile(
        path.join(tempDir, 'examples_project', 'models', 'example.sql'),
        'utf8',
      ),
    ).resolves.toBe('select 1;\n');
  });

  it('prompts for missing inputs interactively', async () => {
    /** @type {import('../../cli/assets/extract-templates.js').extractTemplates} */
    const extractTemplatesImpl = async () => ({
      mode: 'fs',
      filesWritten: 0,
    });
    const extractTemplatesFn = jest.fn(extractTemplatesImpl);
    const promptFn = jest.fn(async () => ({
      project_name: 'Prompt Project',
      include_examples: false,
    }));

    await initProject(
      {},
      {
        cwd: tempDir,
        promptFn,
        extractTemplatesFn,
        infoReporter: () => {},
        successReporter: () => {},
      },
    );

    expect(promptFn).toHaveBeenCalledTimes(1);
    expect(extractTemplatesFn).not.toHaveBeenCalled();
    await expect(
      fsp.stat(path.join(tempDir, 'prompt_project')),
    ).resolves.toBeDefined();
  });

  it('rolls back the project directory when initialization fails after creation', async () => {
    const fsModule = {
      mkdir: fsp.mkdir.bind(fsp),
      writeFile: async () => {
        throw new Error('write failed');
      },
      rm: fsp.rm.bind(fsp),
    };

    await expect(
      initProject(
        {
          projectName: 'Broken Project',
          includeExamples: false,
        },
        {
          cwd: tempDir,
          fsModule,
          infoReporter: () => {},
          successReporter: () => {},
        },
      ),
    ).rejects.toThrow(/write failed/i);

    await expect(
      fsp.stat(path.join(tempDir, 'broken_project')),
    ).rejects.toThrow();
  });

  it('fails when the target directory already exists and leaves it intact', async () => {
    const existingDir = path.join(tempDir, 'existing_project');
    await fsp.mkdir(existingDir, { recursive: true });
    await fsp.writeFile(path.join(existingDir, 'keep.txt'), 'keep me');

    await expect(
      initProject(
        {
          projectName: 'Existing Project',
          includeExamples: false,
        },
        {
          cwd: tempDir,
          infoReporter: () => {},
          successReporter: () => {},
        },
      ),
    ).rejects.toThrow(/already exists/i);

    await expect(
      fsp.readFile(path.join(existingDir, 'keep.txt'), 'utf8'),
    ).resolves.toBe('keep me');
  });
});
