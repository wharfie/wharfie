import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createAwsSingleNodeDeploymentProvider,
  createHetznerSingleNodeDeploymentProvider,
  createSingleNodeDeploymentIntent,
  type AwsSingleNodeDeploymentProvider,
  type HetznerSingleNodeDeploymentProvider,
  type SingleNodeDeploymentIntent,
} from '@wharfie/wharfie/single-node-deployment';

const aws: AwsSingleNodeDeploymentProvider =
  createAwsSingleNodeDeploymentProvider('us-east-1');
const hetzner: HetznerSingleNodeDeploymentProvider =
  createHetznerSingleNodeDeploymentProvider('fsn1');

const intent: Readonly<SingleNodeDeploymentIntent> =
  createSingleNodeDeploymentIntent({
    deployment: { id: 'hello-production' },
    appId: 'hello-app',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider: hetzner,
  });

const schemaVersion: 1 = intent.schemaVersion;
const kind: 'singleNodeDeploymentIntent' = intent.kind;
const targetArchitecture: 'x64' = intent.target.architecture;
const providerKind: 'aws' | 'hetzner' = intent.provider.kind;
void aws;
void schemaVersion;
void kind;
void targetArchitecture;
void providerKind;

createSingleNodeDeploymentIntent({
  deployment: {
    id: 'extra-field',
    // @ts-expect-error Deployment identity has one exact field.
    displayName: 'Extra field',
  },
  appId: 'typed-app',
  target: {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'x64',
    libc: 'glibc',
  },
  mode: SINGLE_NODE_DEPLOYMENT_MODE,
  machine: SINGLE_NODE_MACHINE,
  access: { kind: 'public-ssh', allowedIpv4: ['203.0.113.7/32'] },
  provider: aws,
});

// @ts-expect-error The first cloud preview is Linux x64 only.
createSingleNodeDeploymentIntent({
  deployment: { id: 'wrong-architecture' },
  appId: 'typed-app',
  target: {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture: 'arm64',
    libc: 'glibc',
  },
  mode: SINGLE_NODE_DEPLOYMENT_MODE,
  machine: SINGLE_NODE_MACHINE,
  access: { kind: 'public-ssh', allowedIpv4: ['203.0.113.7/32'] },
  provider: aws,
});
