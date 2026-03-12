/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import {
  createConfigCommand,
  resolveRegionDefault,
  validateConfigAnswers,
} from '../../cli/cmds/config.js';

describe('wharfie config command', () => {
  it('falls back to an empty region default when the terminal region lookup fails', async () => {
    await expect(
      resolveRegionDefault({
        env: {},
        stsClient: {
          sts: {
            config: {
              region: async () => {
                throw new Error('region unavailable');
              },
            },
          },
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('prompts and writes config even when AWS region lookup throws', async () => {
    const tempDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-config-cmd-'),
    );
    const configDir = path.join(tempDir, 'config');
    const configFilePath = path.join(configDir, 'wharfie.config');

    /** @type {import('inquirer').QuestionCollection | undefined} */
    let capturedQuestions;

    const command = createConfigCommand({
      envGetter: () => ({
        CONFIG_DIR: configDir,
        CONFIG_FILE_PATH: configFilePath,
      }),
      createSTS: () => ({
        sts: {
          config: {
            region: async () => {
              throw new Error('region unavailable');
            },
          },
        },
      }),
      promptFn: async (questions) => {
        capturedQuestions = questions;
        return {
          deployment_name: 'demo-deployment',
          region: 'us-east-1',
          service_bucket: 'demo-bucket',
        };
      },
    });

    await command.parseAsync(['node', 'config'], { from: 'node' });

    expect(capturedQuestions).toBeDefined();
    const questionList = Array.isArray(capturedQuestions)
      ? capturedQuestions
      : [capturedQuestions];
    expect(questionList[1]).toMatchObject({
      name: 'region',
      default: undefined,
    });
    await expect(fsp.readFile(configFilePath, 'utf8')).resolves.toEqual(
      JSON.stringify(
        {
          deployment_name: 'demo-deployment',
          region: 'us-east-1',
          service_bucket: 'demo-bucket',
        },
        null,
        2,
      ),
    );
  });

  it('trims and validates prompt answers', () => {
    expect(
      validateConfigAnswers({
        deployment_name: ' demo-deployment ',
        region: ' us-east-1 ',
        service_bucket: ' demo-bucket ',
      }),
    ).toEqual({
      deployment_name: 'demo-deployment',
      region: 'us-east-1',
      service_bucket: 'demo-bucket',
    });

    expect(() =>
      validateConfigAnswers({
        deployment_name: 'demo-deployment',
        region: 'us-east-1',
        service_bucket: '   ',
      }),
    ).toThrow(/service_bucket is required/i);
  });
});
