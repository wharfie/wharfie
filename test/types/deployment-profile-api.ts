import {
  DEPLOYMENT_MODE,
  createAwsSingleNodeProvider,
  createDeploymentProfile,
  type AwsSingleNodeProvider,
  type DeploymentProfile,
} from '@wharfie/wharfie/deployment-profile';

const provider: AwsSingleNodeProvider =
  createAwsSingleNodeProvider('us-east-1');
const profile: Readonly<DeploymentProfile> = createDeploymentProfile({
  profile: { id: 'production' },
  appId: 'typed-app',
  target: {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'arm64',
    libc: 'glibc',
  },
  mode: DEPLOYMENT_MODE,
  provider,
});

const schemaVersion: 2 = profile.schemaVersion;
const kind: 'deploymentProfile' = profile.kind;
const modeKind: 'single-node-systemd-user' = profile.mode.kind;
const providerKind: 'aws' = profile.provider.kind;
const architecture: 'arm64' | 'x64' = profile.target.architecture;
void schemaVersion;
void kind;
void modeKind;
void providerKind;
void architecture;

// @ts-expect-error Managed deployment profiles support Linux only.
createDeploymentProfile({
  profile: { id: 'invalid-target' },
  appId: 'typed-app',
  target: {
    nodeVersion: '24.13.1',
    platform: 'darwin',
    architecture: 'arm64',
    libc: 'glibc',
  },
  mode: DEPLOYMENT_MODE,
  provider,
});

createDeploymentProfile({
  profile: {
    id: 'extra-field',
    // @ts-expect-error Deployment profile identity has one exact field.
    displayName: 'Extra field',
  },
  appId: 'typed-app',
  target: {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  },
  mode: DEPLOYMENT_MODE,
  provider,
});
