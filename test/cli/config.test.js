/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { clearConfig, setConfig, validate } from '../../cli/config.js';

describe('cli/config', () => {
  afterEach(() => {
    clearConfig();
  });

  it('accepts long-lived AWS credentials without a session token', async () => {
    setConfig({
      deployment_name: 'demo-deployment',
      region: 'us-east-1',
      service_bucket: 'demo-bucket',
    });

    await expect(
      validate({
        credentialProvider: async () => ({
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
        stsClient: {
          sts: {
            config: {
              region: async () => 'us-east-1',
            },
          },
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects incomplete AWS credentials', async () => {
    setConfig({
      deployment_name: 'demo-deployment',
      region: 'us-east-1',
      service_bucket: 'demo-bucket',
    });

    await expect(
      validate({
        credentialProvider: async () => ({
          accessKeyId: 'access-key',
        }),
        stsClient: {
          sts: {
            config: {
              region: async () => 'us-east-1',
            },
          },
        },
      }),
    ).rejects.toThrow(/credentials are incomplete/i);
  });

  it('reports a missing AWS region with a dedicated error', async () => {
    setConfig({
      deployment_name: 'demo-deployment',
      region: 'us-east-1',
      service_bucket: 'demo-bucket',
    });

    await expect(
      validate({
        credentialProvider: async () => ({
          accessKeyId: 'access-key',
          secretAccessKey: 'secret-key',
        }),
        stsClient: {
          sts: {
            config: {
              region: async () => undefined,
            },
          },
        },
      }),
    ).rejects.toThrow(/region is not configured/i);
  });

  it('reports a missing service bucket distinctly', () => {
    expect(() =>
      setConfig({
        deployment_name: 'demo-deployment',
        region: 'us-east-1',
      }),
    ).toThrow(/service bucket/i);
  });
});
