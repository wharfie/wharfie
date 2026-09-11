/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCommand } from '../../scripts/package-verification.js';
import {
  getCommandFailure,
  recordCommandFailure,
  retainFailureDiagnostic,
} from '../../scripts/validation-failure.js';

/** @type {string[]} */
const roots = [];
function fixture() {
  const root = realpathSync(
    mkdtempSync(path.join(os.tmpdir(), 'wharfie-validation-report-test-')),
  );
  roots.push(root);
  return { root, directory: path.join(root, 'reports'), log: jest.fn() };
}

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

/** @type {import('../../scripts/validation-failure.js').FailureDiagnostic} */
const failure = {
  runner: 'jest',
  phase: 'jest',
  command: 'jest',
  durationMs: 42,
  status: 23,
  signal: null,
};

describe('retained validation failure reports', () => {
  it('bounds history and bytes while leaving caller files, links and directories alone', () => {
    const options = fixture();
    mkdirSync(options.directory);
    const callerFile = path.join(options.directory, 'notes.txt');
    writeFileSync(callerFile, 'caller-owned');
    const foreignReport = path.join(
      options.directory,
      'jest-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json',
    );
    writeFileSync(foreignReport, JSON.stringify({ format: 'caller-data' }));
    const foreignDirectory = path.join(
      options.directory,
      'jest-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.json',
    );
    mkdirSync(foreignDirectory);

    for (let index = 0; index < 30; index += 1)
      retainFailureDiagnostic({ ...failure, status: index }, options);
    const reports = readdirSync(options.directory).filter(
      (file) =>
        file !== path.basename(foreignReport) &&
        file !== path.basename(foreignDirectory) &&
        file !== 'notes.txt',
    );
    expect(reports).toHaveLength(10);
    expect(
      reports
        .map(
          (file) =>
            JSON.parse(readFileSync(path.join(options.directory, file), 'utf8'))
              .status,
        )
        .sort((a, b) => a - b),
    ).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
    for (const file of reports)
      expect(
        statSync(path.join(options.directory, file)).size,
      ).toBeLessThanOrEqual(2048);
    expect(readFileSync(callerFile, 'utf8')).toBe('caller-owned');
    expect(JSON.parse(readFileSync(foreignReport, 'utf8'))).toEqual({
      format: 'caller-data',
    });
    expect(statSync(foreignDirectory).isDirectory()).toBe(true);
    expect(options.log).toHaveBeenCalledTimes(30);
  });

  it('retains separate histories for Jest and SEA and reports the actual path', () => {
    const options = fixture();
    const jestPath = retainFailureDiagnostic(failure, options);
    for (let index = 0; index < 12; index += 1)
      retainFailureDiagnostic(
        {
          ...failure,
          runner: 'package-sea',
          phase: 'install-package',
          command: 'npm',
        },
        options,
      );
    expect(existsSync(String(jestPath))).toBe(true);
    expect(readdirSync(options.directory)).toHaveLength(11);
    expect(options.log).toHaveBeenCalledWith(
      `Validation failure report: ${jestPath}\n`,
    );
    expect(JSON.parse(readFileSync(String(jestPath), 'utf8'))).toMatchObject(
      failure,
    );
  });

  it('omits raw arguments, environment, output, error messages and invalid scalar values', () => {
    const options = fixture();
    const error = recordCommandFailure(
      new Error('secret-error'),
      '/private/secret-executable',
      { status: 7, signal: null },
    );
    const input = {
      ...failure,
      ...getCommandFailure(error),
      phase: 'secret phase\n' + 'x'.repeat(10000),
      durationMs: Infinity,
      status: Infinity,
      signal: 'SECRET'.repeat(10000),
      args: ['--token=secret-argument'],
      env: { TOKEN: 'secret-environment' },
      output: 'secret-output',
      error,
    };
    const reportPath = retainFailureDiagnostic(input, options);
    const text = readFileSync(String(reportPath), 'utf8');
    expect(text).not.toMatch(/secret|SECRET|TOKEN|token/);
    expect(JSON.parse(text)).toMatchObject({
      phase: 'unknown',
      command: 'packaged-app',
      durationMs: null,
      status: null,
      signal: null,
    });
    expect(Buffer.byteLength(text)).toBeLessThan(2048);
  });

  it('keeps diagnostic I/O failures and broken stderr from replacing validation failures', () => {
    const options = fixture();
    writeFileSync(options.directory, 'caller-file');
    expect(retainFailureDiagnostic(failure, options)).toBeUndefined();
    expect(readFileSync(options.directory, 'utf8')).toBe('caller-file');
    const writable = fixture();
    const reportPath = retainFailureDiagnostic(failure, {
      ...writable,
      log: () => {
        throw new Error('closed stderr');
      },
    });
    expect(existsSync(String(reportPath))).toBe(true);
    expect(() =>
      retainFailureDiagnostic(failure, {
        ...options,
        log: () => {
          throw new Error('closed stderr');
        },
      }),
    ).not.toThrow();
  });

  it('leaves an occupied publication guard untouched and skips that report', () => {
    const options = fixture();
    mkdirSync(options.directory);
    const guard = path.join(options.directory, '.jest-report.lock');
    mkdirSync(guard);
    writeFileSync(path.join(guard, 'caller-owned'), 'keep');
    expect(retainFailureDiagnostic(failure, options)).toBeUndefined();
    expect(readdirSync(options.directory)).toEqual(['.jest-report.lock']);
    expect(readFileSync(path.join(guard, 'caller-owned'), 'utf8')).toBe('keep');
  });

  it('keeps at most ten reports when independent processes fail concurrently', async () => {
    const options = fixture();
    const helperUrl = new URL(
      '../../scripts/validation-failure.js',
      import.meta.url,
    ).href;
    const script = `
      const { retainFailureDiagnostic } = await import(process.argv[1]);
      for (let index = 0; index < 40; index += 1) {
        retainFailureDiagnostic({ runner: 'jest', phase: 'jest', command: 'jest', durationMs: index, status: 23 }, { directory: process.argv[2], log() {} });
      }
    `;
    const exits = await Promise.all(
      Array.from(
        { length: 4 },
        () =>
          new Promise((resolve, reject) => {
            const child = spawn(
              process.execPath,
              [
                '--input-type=module',
                '--eval',
                script,
                helperUrl,
                options.directory,
              ],
              { stdio: 'ignore' },
            );
            child.once('error', reject);
            child.once('exit', (code) => resolve(code));
          }),
      ),
    );
    expect(exits).toEqual([0, 0, 0, 0]);
    expect(readdirSync(options.directory)).toHaveLength(10);
    expect(existsSync(path.join(options.directory, '.jest-report.lock'))).toBe(
      false,
    );
  });

  const itOnUnix = process.platform === 'win32' ? it.skip : it;
  itOnUnix(
    'never prunes symlinks or hard links and refuses a symlink report directory',
    () => {
      const options = fixture();
      mkdirSync(options.directory);
      const outside = path.join(options.root, 'outside.json');
      writeFileSync(
        outside,
        JSON.stringify({
          format: 'wharfie-validation-failure-v1',
          runner: 'jest',
        }),
      );
      const symbolic = path.join(
        options.directory,
        'jest-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json',
      );
      const hard = path.join(
        options.directory,
        'jest-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.json',
      );
      symlinkSync(outside, symbolic);
      linkSync(outside, hard);
      for (let index = 0; index < 12; index += 1)
        retainFailureDiagnostic(failure, options);
      expect(existsSync(symbolic)).toBe(true);
      expect(existsSync(hard)).toBe(true);
      expect(readFileSync(outside, 'utf8')).toBe(
        JSON.stringify({
          format: 'wharfie-validation-failure-v1',
          runner: 'jest',
        }),
      );
      const linkedDirectory = path.join(options.root, 'linked-reports');
      symlinkSync(options.directory, linkedDirectory);
      expect(
        retainFailureDiagnostic(failure, {
          ...options,
          directory: linkedDirectory,
        }),
      ).toBeUndefined();
      const parentLink = path.join(options.root, 'linked-parent');
      symlinkSync(options.directory, parentLink);
      expect(
        retainFailureDiagnostic(failure, {
          ...options,
          directory: path.join(parentLink, 'new-reports'),
        }),
      ).toBeUndefined();
      expect(existsSync(path.join(options.directory, 'new-reports'))).toBe(
        false,
      );
    },
  );

  itOnUnix.each([
    { mode: 'preflight', phase: 'preflight', status: null, signal: null },
    {
      mode: 'allocation',
      phase: 'workspace-create',
      status: null,
      signal: null,
    },
    {
      mode: 'command-exit',
      phase: 'package-tarball',
      status: 23,
      signal: null,
    },
    {
      mode: 'command-signal',
      phase: 'package-tarball',
      status: null,
      signal: 'SIGABRT',
    },
    {
      mode: 'report-unavailable',
      phase: 'package-tarball',
      status: 23,
      signal: null,
    },
  ])(
    'reports actual SEA verifier $mode failures and cleans its allocated workspaces',
    ({ mode, phase, status, signal }) => {
      const options = fixture();
      const scripts = path.join(options.root, 'scripts');
      const temporary = path.join(options.root, 'temp');
      mkdirSync(scripts);
      mkdirSync(temporary);
      symlinkSync(
        fileURLToPath(new URL('../../src/', import.meta.url)),
        path.join(options.root, 'src'),
      );
      const sourceScripts = fileURLToPath(
        new URL('../../scripts/', import.meta.url),
      );
      // Run the actual entry point in an isolated checkout. Its helper imports
      // remain real; only child-process launch is injected before ESM imports.
      for (const file of readdirSync(sourceScripts).filter((file) =>
        file.endsWith('.js'),
      )) {
        const source = path.join(sourceScripts, file);
        const destination = path.join(scripts, file);
        if (
          [
            'verify-package-sea.js',
            'package-verification.js',
            'validation-failure.js',
          ].includes(file)
        )
          copyFileSync(source, destination);
        else symlinkSync(source, destination);
      }
      const metadata = JSON.parse(
        readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
      );
      if (mode === 'preflight') metadata.devEngines.runtime.version = '0.0.0';
      writeFileSync(
        path.join(options.root, 'package.json'),
        JSON.stringify(metadata),
      );
      if (mode === 'report-unavailable')
        writeFileSync(path.join(options.root, '.wharfie'), 'caller-owned');
      const preload = path.join(options.root, 'preload.js');
      writeFileSync(
        preload,
        `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      childProcess.spawnSync = () => ({ status: ${status}, signal: ${JSON.stringify(signal)}, stdout: '', stderr: '' });
      syncBuiltinESMExports();
    `,
      );
      const result = spawnSync(
        process.execPath,
        ['--import', preload, path.join(scripts, 'verify-package-sea.js')],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            TMPDIR:
              mode === 'allocation'
                ? path.join(temporary, 'missing')
                : temporary,
          },
          timeout: 10000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(readdirSync(temporary)).toEqual([]);
      if (mode === 'report-unavailable') {
        expect(result.stderr).toContain(
          'Could not retain validation failure report',
        );
        expect(result.stderr).toContain('exited with status 23');
        expect(readFileSync(path.join(options.root, '.wharfie'), 'utf8')).toBe(
          'caller-owned',
        );
      } else {
        const directory = path.join(
          options.root,
          '.wharfie',
          'validation-failures',
        );
        const reports = readdirSync(directory);
        expect(reports).toHaveLength(1);
        const reportPath = path.join(directory, String(reports[0]));
        expect(result.stderr).toContain(
          `Validation failure report: ${reportPath}`,
        );
        expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toMatchObject({
          runner: 'package-sea',
          phase,
          status,
          signal,
          command: phase === 'package-tarball' ? 'npm' : 'package-sea',
          durationMs: expect.any(Number),
        });
      }
    },
  );

  it.each([
    ['process.exit(23)', 23, null],
    ['process.kill(process.pid, "SIGTERM")', null, 'SIGTERM'],
  ])(
    'preserves real child status or signal from package verification: %s',
    (script, status, signal) => {
      let failure;
      try {
        runCommand(process.execPath, ['--eval', String(script)], {
          capture: true,
        });
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(Error);
      expect(getCommandFailure(failure)).toEqual({
        command: 'node',
        status,
        signal,
      });
    },
  );
});
