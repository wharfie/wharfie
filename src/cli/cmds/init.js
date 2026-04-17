import { Command } from 'commander';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import fs from 'node:fs';
import inquirer from 'inquirer';

import { dirPathFromImportMetaUrl } from '../../core/lib/import-meta-path.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../output/basic.js';
import { extractTemplates } from '../assets/extract-templates.js';

const PROJECT_NAME_RE = /^[a-zA-Z0-9_ ]*$/;
const TEMPLATE_V2 = 'v2';
const TEMPLATE_LEGACY_V1 = 'legacy-v1';
const MODULE_DIR = dirPathFromImportMetaUrl(import.meta.url);

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
 * @param {string | undefined} raw
 * @returns {'v2' | 'legacy-v1'}
 */
function normalizeTemplateName(raw) {
  const value = String(raw || TEMPLATE_V2)
    .trim()
    .toLowerCase();

  if (!value || value === TEMPLATE_V2) return TEMPLATE_V2;
  if (value === TEMPLATE_LEGACY_V1 || value === 'legacy' || value === 'v1') {
    return TEMPLATE_LEGACY_V1;
  }

  throw new Error(
    `Unsupported template '${raw}'. Supported templates: ${TEMPLATE_V2}, ${TEMPLATE_LEGACY_V1}.`,
  );
}

/**
 * @param {{ projectName?: string | undefined, includeExamples?: boolean | undefined, template?: string | undefined }} options
 * @returns {Promise<{ projectName: string, includeExamples: boolean, template: 'v2' | 'legacy-v1' }>}
 */
async function resolveInitInputs(options) {
  /** @type {string | undefined} */
  let projectName = options.projectName;
  /** @type {boolean | undefined} */
  let includeExamples = options.includeExamples;

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
    template: normalizeTemplateName(options.template),
  };
}

/**
 * @param {string} projectName - projectName.
 * @returns {string} - Result.
 */
function buildV2PackageJson(projectName) {
  return `${JSON.stringify(
    {
      name: projectName,
      private: true,
      type: 'module',
      version: '0.0.0',
    },
    null,
    2,
  )}
`;
}

/**
 * @param {string} projectName - projectName.
 * @returns {string} - Result.
 */
function buildV2CliSource(projectName) {
  return `const HELP_TEXT = ${JSON.stringify(
    `${projectName} example CLI

Usage:
  hello [who]   Print a greeting
  help          Show this help`,
  )};

export async function main(argv = process.argv) {
  const args = Array.isArray(argv) ? argv.slice(2) : [];
  const [command = 'help', ...rest] = args;

  if (command === 'help' || command === '--help' || command === '-h') {
    process.stdout.write(\`\${HELP_TEXT}\n\`);
    return;
  }

  if (command === 'hello') {
    const who = typeof rest[0] === 'string' && rest[0].trim() ? rest[0] : 'world';
    process.stdout.write(\`hello \${who}\n\`);
    return;
  }

  throw new Error(\`Unknown command: \${command}\`);
}

export default main;
`;
}

/**
 * @param {string} projectName - projectName.
 * @returns {string} - Result.
 */
function buildV2HelloActivitySource(projectName) {
  return `export async function hello(event = {}, context = {}) {
  const who =
    typeof event?.who === 'string' && event.who.trim() ? event.who.trim() : 'world';

  return {
    app: ${JSON.stringify(projectName)},
    message: \`hello \${who}\`,
    availableResources: Object.keys(context?.resources || {}).sort(),
  };
}

export default hello;
`;
}

/**
 * @param {boolean} includeExamples - includeExamples.
 * @returns {string} - Result.
 */
function buildWorkflowAndSchedulerSource(includeExamples) {
  if (!includeExamples) return '';

  return `,
  workflows: {
    helloPipeline: {
      actions: [
        { id: 'start', type: 'START' },
        {
          id: 'run-hello',
          type: 'INVOKE_FUNCTION',
          activity: 'hello',
          inputs: { who: 'workflow-user' },
          dependsOn: ['start'],
        },
        { id: 'finish', type: 'FINISH', dependsOn: ['run-hello'] },
      ],
    },
  },
  scheduler: {
    triggers: [{ activity: 'hello', cron: '*/15 * * * *' }],
  }`;
}

/**
 * @param {string} projectName - projectName.
 * @param {boolean} includeExamples - includeExamples.
 * @returns {string} - Result.
 */
function buildV2AppSource(projectName, includeExamples) {
  const workflowAndScheduler = buildWorkflowAndSchedulerSource(includeExamples);

  return `export default {
  name: '${projectName}',
  cli: {
    entrypoint: './src/cli.js',
    export: 'main',
  },
  targets: [
    {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
    },
  ],
  resources: {
    db: {
      adapter: 'vanilla',
      options: { path: '.wharfie/runtime' },
    },
    queue: {
      adapter: 'vanilla',
      options: { path: '.wharfie/runtime' },
    },
    objectStorage: {
      adapter: 'vanilla',
      options: { path: '.wharfie/runtime' },
    },
  },
  activities: {
    hello: {
      entrypoint: {
        path: './src/activities/hello.js',
        export: 'hello',
      },
    },
  }${workflowAndScheduler}
};
`;
}

/**
 * @param {string} projectName - projectName.
 * @param {boolean} includeExamples - includeExamples.
 * @returns {string} - Result.
 */
function buildV2Readme(projectName, includeExamples) {
  const exampleSection = includeExamples
    ? `
The generated manifest also includes a sample workflow and scheduler trigger so you can inspect how activities compose into longer-running execution paths.

\`\`\`bash
wharfie ops run --activity hello --dir . --event '{"who":"ops-user"}'
\`\`\`
`
    : '';

  return `# ${projectName}

Generated by \`wharfie init\`.

## Try it

\`\`\`bash
wharfie app manifest .
wharfie app run hello --dir . --event '{"who":"cli-user"}'
wharfie app package .
\`\`\`
${exampleSection}`;
}

/**
 * @param {string} projectDir - projectDir.
 * @param {string} projectName - projectName.
 * @param {boolean} includeExamples - includeExamples.
 * @returns {Promise<void>} - Result.
 */
async function initializeV2Project(projectDir, projectName, includeExamples) {
  await fsp.mkdir(path.join(projectDir, 'src', 'activities'), {
    recursive: true,
  });

  await Promise.all([
    fsp.writeFile(
      path.join(projectDir, 'package.json'),
      buildV2PackageJson(projectName),
    ),
    fsp.writeFile(
      path.join(projectDir, 'README.md'),
      buildV2Readme(projectName, includeExamples),
    ),
    fsp.writeFile(
      path.join(projectDir, 'wharfie.app.js'),
      buildV2AppSource(projectName, includeExamples),
    ),
    fsp.writeFile(
      path.join(projectDir, 'src', 'cli.js'),
      buildV2CliSource(projectName),
    ),
    fsp.writeFile(
      path.join(projectDir, 'src', 'activities', 'hello.js'),
      buildV2HelloActivitySource(projectName),
    ),
  ]);
}

/**
 * @param {string} projectDir - projectDir.
 * @returns {Promise<void>} - Result.
 */
async function initializeLegacyV1Project(projectDir) {
  await Promise.all([
    fsp.writeFile(path.join(projectDir, 'wharfie.yaml'), ''),
    fsp.mkdir(path.join(projectDir, 'sources')),
    fsp.mkdir(path.join(projectDir, 'models')),
  ]);
}

/**
 * Initializes a new Wharfie project directory.
 *
 * NOTE: When running from a SEA binary, legacy example templates are embedded
 * as SEA assets and extracted at runtime.
 *
 * @param {{ projectName?: string | undefined, includeExamples?: boolean | undefined, template?: string | undefined }} options
 * @returns {Promise<void>}
 */
async function initProject(options) {
  const { projectName, includeExamples, template } =
    await resolveInitInputs(options);

  const projectDir = path.join(process.cwd(), projectName);

  if (fs.existsSync(projectDir)) {
    throw new Error(
      `Directory already exists with name ${projectName}, please pick a different project name.`,
    );
  }

  if (template === TEMPLATE_V2) {
    displayInfo(`Initializing v2 app ${projectName}...`);
    await fsp.mkdir(projectDir, { recursive: false });
    await initializeV2Project(projectDir, projectName, includeExamples);

    displaySuccess(
      `App ${projectName} initialized successfully!\n\n` +
        `Run 'cd ${projectName}' and then 'wharfie app manifest .'.`,
    );
    return;
  }

  displayInfo(`Initializing legacy v1 project ${projectName}...`);
  await fsp.mkdir(projectDir, { recursive: false });
  await initializeLegacyV1Project(projectDir);

  if (includeExamples) {
    const diskTemplatesDir = path.resolve(
      MODULE_DIR,
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
    `Legacy v1 project ${projectName} initialized successfully!\n\n` +
      `Run 'cd ${projectName}' and then explore your sources/models.`,
  );
}

const initCommand = new Command('init')
  .description(
    'Initialize a new Wharfie app directory (default: v2; use --template legacy-v1 for the old Athena scaffold)',
  )
  .argument('[project_name]', 'Project name (otherwise prompt)')
  .option(
    '--template <template>',
    'Scaffold template to use (v2|legacy-v1)',
    TEMPLATE_V2,
  )
  .option(
    '--no-examples',
    'Do not include sample workflow/scheduler content (or legacy model/source examples)',
  )
  .action(async (projectName, cmd) => {
    try {
      await initProject({
        projectName: typeof projectName === 'string' ? projectName : undefined,
        includeExamples: cmd.examples,
        template: cmd.template,
      });
    } catch (err) {
      displayFailure(err);
      process.exitCode = 1;
    }
  });

export default initCommand;
