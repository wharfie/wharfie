export interface DeploymentTarget {
  readonly nodeVersion: string;
  readonly platform: 'linux';
  readonly architecture: 'arm64' | 'x64';
  readonly libc: 'glibc';
}

export interface AwsSingleNodeProvider {
  readonly kind: 'aws';
  readonly contractVersion: 3;
  readonly scope: {
    readonly region: string;
  };
  readonly configuration: {
    readonly node: {
      readonly management: 'managed';
      readonly capacity: 'small';
    };
    readonly applicationState: {
      readonly management: 'managed';
      readonly storage: 'attached-encrypted-volume';
      readonly onDestroy: 'retain';
    };
    readonly controlState: {
      readonly management: 'managed';
      readonly storage: 'attached-encrypted-volume';
      readonly onDestroy: 'retain';
    };
    readonly artifactStorage: {
      readonly management: 'managed';
      readonly storage: 'private-provider-object';
      readonly onDestroy: 'purge';
    };
    readonly runtimeIdentity: {
      readonly management: 'managed';
      readonly kind: 'host-ssm-artifact-read-health-read-write-current-object';
    };
    readonly networking: {
      readonly management: 'managed';
      readonly kind: 'public-egress-no-ingress';
    };
    readonly ingress: {
      readonly management: 'none';
    };
  };
}

export declare const DEPLOYMENT_MODE: Readonly<{
  kind: 'single-node-systemd-user';
  version: 1;
}>;

export interface DeploymentProfileInput {
  readonly profile: {
    readonly id: string;
  };
  readonly appId: string;
  readonly target: DeploymentTarget;
  readonly mode: typeof DEPLOYMENT_MODE;
  readonly provider: AwsSingleNodeProvider;
}

export interface DeploymentProfile extends DeploymentProfileInput {
  readonly schemaVersion: 2;
  readonly kind: 'deploymentProfile';
  readonly profileRevisionId: string;
}

type StrictShape<Actual, Shape> = Shape extends unknown
  ? Actual extends Shape
    ? Shape extends readonly (infer ShapeItem)[]
      ? Actual extends readonly (infer ActualItem)[]
        ? Actual & readonly StrictShape<ActualItem, ShapeItem>[]
        : never
      : Shape extends object
        ? Actual extends object
          ? Actual &
              Record<Exclude<keyof Actual, keyof Shape>, never> & {
                [Key in keyof Actual & keyof Shape]: StrictShape<
                  Actual[Key],
                  Shape[Key]
                >;
              }
          : never
        : Actual
    : never
  : never;

export declare function createAwsSingleNodeProvider(
  region: string,
): AwsSingleNodeProvider;

export declare function createDeploymentProfile<const Input>(
  input: Input &
    DeploymentProfileInput &
    StrictShape<Input, DeploymentProfileInput>,
): Readonly<DeploymentProfile>;
