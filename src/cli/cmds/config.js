import fs from 'node:fs';

import { Command } from 'commander';
import inquirer from 'inquirer';

import STS from '../../core/lib/aws/sts.js';
import { displayFailure, displaySuccess } from '../output/basic.js';

const configCommand = new Command('config')
  .description('Configure legacy AWS deployment settings')
  .action(async () => {
    const sts = new STS({});

    /**
     * @type {import('inquirer').QuestionCollection}
     */
    const questions = [
      {
        type: 'input',
        name: 'deployment_name',
        message:
          'legacy Wharfie deployment name (also used by legacy wharfie.yaml files):',
        default: process.env.WHARFIE_DEPLOYMENT_NAME,
      },
      {
        type: 'input',
        name: 'region',
        message: 'legacy Wharfie AWS region:',
        default: process.env.WHARFIE_REGION || (await sts.sts.config.region()),
      },
      {
        type: 'input',
        name: 'service_bucket',
        message: 'legacy Wharfie service bucket:',
        default: process.env.WHARFIE_SERVICE_BUCKET,
      },
    ];

    const answers = await inquirer.prompt(questions);

    try {
      if (!answers.deployment_name) {
        throw new Error('deployment_name is required');
      }
      if (!answers.region) {
        throw new Error('region is required');
      }
      if (!answers.service_bucket) {
        throw new Error('service_bucket is required');
      }
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
      return;
    }

    const configDir = process.env.CONFIG_DIR;
    const configFilePath = process.env.CONFIG_FILE_PATH;

    if (!configDir || !configFilePath) {
      displayFailure(
        'CONFIG_DIR/CONFIG_FILE_PATH not set. Run via `wharfie` CLI.',
      );
      process.exitCode = 1;
      return;
    }

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configFilePath, JSON.stringify(answers, null, 2));

    displaySuccess(`Config written to ${configFilePath}`);
  });

export default configCommand;
