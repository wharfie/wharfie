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
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CMD_IMPORT = '../../../src/core/lib/cmd.js';
const SIGNATURE_IMPORT =
  '../../../src/core/resources/builds/macos-binary-signature.js';
const IDENTITY_HASH = '0123456789ABCDEF0123456789ABCDEF01234567';

/** @type {ReturnType<typeof jest.fn>} */
let runCmd;
/** @type {ReturnType<typeof jest.fn>} */
let execFileOutput;

beforeEach(() => {
  jest.resetModules();
  runCmd = jest.fn(async () => {});
  execFileOutput = jest.fn(async () => ({ stdout: '', stderr: '' }));
  jest.unstable_mockModule(CMD_IMPORT, () => ({
    execFileOutput,
    runCmd,
  }));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('MacOSBinarySignature', () => {
  it('parses security codesigning identities without retaining the summary', async () => {
    const { parseCodeSigningIdentities } = await import(SIGNATURE_IMPORT);
    const secondHash = '89abcdef0123456789abcdef0123456789abcdef';

    expect(
      parseCodeSigningIdentities(`
  1) ${IDENTITY_HASH} "Developer ID Application: Example One (TEAMONE)"
  2) ${secondHash} "Apple Development: Example Two (TEAMTWO)"
     2 valid identities found
`),
    ).toEqual([
      {
        hash: IDENTITY_HASH,
        name: 'Developer ID Application: Example One (TEAMONE)',
      },
      {
        hash: secondHash.toUpperCase(),
        name: 'Apple Development: Example Two (TEAMTWO)',
      },
    ]);
  });

  it('fails clearly when a temporary keychain has zero or ambiguous identities', async () => {
    const { default: MacOSBinarySignature } = await import(SIGNATURE_IMPORT);
    const signature = new MacOSBinarySignature({
      name: 'identity-selection',
      properties: { binaryPath: '/tmp/example-binary' },
    });

    execFileOutput.mockResolvedValueOnce({
      stdout: '     0 valid identities found\n',
      stderr: '',
    });
    await expect(
      signature.resolveCodeSigningIdentity('/tmp/private.keychain-db'),
    ).rejects.toThrow(/No valid codesigning identity/i);

    execFileOutput.mockResolvedValueOnce({
      stdout: `
  1) ${IDENTITY_HASH} "Identity One"
  2) 89ABCDEF0123456789ABCDEF0123456789ABCDEF "Identity Two"
     2 valid identities found
`,
      stderr: '',
    });
    await expect(
      signature.resolveCodeSigningIdentity('/tmp/private.keychain-db'),
    ).rejects.toThrow(/exactly one codesigning identity.*found 2/i);
  });

  it('uses a private signing directory and removes it after signing fails', async () => {
    const sourceDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-signature-test-'),
    );
    const binaryPath = path.join(sourceDir, 'app');
    await fsp.writeFile(binaryPath, 'binary', 'utf8');

    const credentials = {
      certificateBase64: Buffer.from('certificate-bytes').toString('base64'),
      certificatePassword: 'certificate-password-sentinel',
      keychainPassword: 'keychain-password-sentinel',
    };
    /** @type {string | undefined} */
    let signingDir;
    /** @type {number | undefined} */
    let signingDirMode;
    /** @type {number | undefined} */
    let certificateMode;

    execFileOutput.mockResolvedValue({
      stdout: `  1) ${IDENTITY_HASH} "Portable Test Identity"\n     1 valid identities found\n`,
      stderr: '',
    });
    runCmd.mockImplementation(async (command, args) => {
      if (command === 'security' && args[0] === 'create-keychain') {
        signingDir = path.dirname(args[3]);
        signingDirMode = (await fsp.stat(signingDir)).mode & 0o777;
        certificateMode =
          (await fsp.stat(path.join(signingDir, 'certificate.p12'))).mode &
          0o777;
      }
      if (command === 'codesign') {
        throw new Error('codesign-failure-sentinel');
      }
      if (command === 'security' && args[0] === 'delete-keychain') {
        throw new Error('cleanup-failure-sentinel');
      }
    });

    try {
      const { default: MacOSBinarySignature } = await import(SIGNATURE_IMPORT);
      const signature = new MacOSBinarySignature({
        name: 'private-signing',
        credentials,
        properties: { binaryPath },
      });

      await expect(signature.signBinary()).rejects.toThrow(
        /macOS signing failed.*cleanup was incomplete/i,
      );

      expect(signingDir).toEqual(
        expect.stringMatching(/wharfie-macos-signing-[^/]+$/),
      );
      expect(signingDirMode).toBe(0o700);
      expect(certificateMode).toBe(0o600);
      await expect(fsp.stat(String(signingDir))).rejects.toMatchObject({
        code: 'ENOENT',
      });

      const createKeychainCall = runCmd.mock.calls.find(
        ([command, args]) =>
          command === 'security' && args[0] === 'create-keychain',
      );
      const importCall = runCmd.mock.calls.find(
        ([command, args]) => command === 'security' && args[0] === 'import',
      );
      const partitionCall = runCmd.mock.calls.find(
        ([command, args]) =>
          command === 'security' && args[0] === 'set-key-partition-list',
      );
      expect(createKeychainCall?.[2]).toEqual({ sensitiveArgIndexes: [2] });
      expect(importCall?.[2]).toEqual({ sensitiveArgIndexes: [5] });
      expect(partitionCall?.[2]).toEqual({ sensitiveArgIndexes: [5] });
      expect(importCall?.[1][1]).toBe(
        path.join(String(signingDir), 'certificate.p12'),
      );
      expect(importCall?.[1][1]).not.toBe('/tmp/devcert.p12');

      expect(execFileOutput).toHaveBeenCalledWith('security', [
        'find-identity',
        '-v',
        '-p',
        'codesigning',
        path.join(String(signingDir), 'signing.keychain-db'),
      ]);
      const codesignCall = runCmd.mock.calls.find(
        ([command]) => command === 'codesign',
      );
      expect(codesignCall?.[1]).toContain(IDENTITY_HASH);
      expect(codesignCall?.[1].join(' ')).not.toContain('Joseph Van Drunen');
      expect(runCmd).toHaveBeenCalledWith('security', [
        'delete-keychain',
        path.join(String(signingDir), 'signing.keychain-db'),
      ]);

      const serialized = JSON.stringify(signature.serialize());
      for (const secret of Object.values(credentials)) {
        expect(serialized).not.toContain(secret);
      }
    } finally {
      await fsp.rm(sourceDir, { recursive: true, force: true });
    }
  });

  it('rejects partial credentials instead of silently ad-hoc signing', async () => {
    const { default: MacOSBinarySignature } = await import(SIGNATURE_IMPORT);
    const signature = new MacOSBinarySignature({
      name: 'partial-signing',
      credentials: { certificateBase64: 'certificate-only' },
      properties: { binaryPath: '/tmp/example-binary' },
    });

    await expect(signature.signBinary()).rejects.toThrow(
      /requires certificateBase64, certificatePassword, and keychainPassword together/i,
    );
    expect(runCmd).not.toHaveBeenCalled();
    expect(execFileOutput).not.toHaveBeenCalled();
  });

  it('fails a successful signing operation when credential cleanup fails', async () => {
    const sourceDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-signature-cleanup-test-'),
    );
    const binaryPath = path.join(sourceDir, 'app');
    await fsp.writeFile(binaryPath, 'binary', 'utf8');

    execFileOutput.mockResolvedValue({
      stdout: `  1) ${IDENTITY_HASH} "Portable Test Identity"\n     1 valid identities found\n`,
      stderr: '',
    });
    runCmd.mockImplementation(async (command, args) => {
      if (command === 'security' && args[0] === 'delete-keychain') {
        throw new Error('cleanup-failure-sentinel');
      }
    });

    try {
      const { default: MacOSBinarySignature } = await import(SIGNATURE_IMPORT);
      const signature = new MacOSBinarySignature({
        name: 'cleanup-failure',
        credentials: {
          certificateBase64: Buffer.from('certificate').toString('base64'),
          certificatePassword: 'certificate-password',
          keychainPassword: 'keychain-password',
        },
        properties: { binaryPath },
      });

      await expect(signature.signBinary()).rejects.toThrow(
        /signing completed.*cleanup was incomplete/i,
      );
    } finally {
      await fsp.rm(sourceDir, { recursive: true, force: true });
    }
  });
});
