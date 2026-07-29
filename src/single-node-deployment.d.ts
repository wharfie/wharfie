export interface SingleNodeDeploymentTarget {
  readonly nodeVersion: string;
  readonly platform: 'linux';
  readonly architecture: 'x64';
  readonly libc: 'glibc';
}

export interface AwsSingleNodeDeploymentProvider {
  readonly kind: 'aws';
  readonly region: string;
}

export interface HetznerSingleNodeDeploymentProvider {
  readonly kind: 'hetzner';
  readonly location: string;
}

export type SingleNodeDeploymentProvider =
  | AwsSingleNodeDeploymentProvider
  | HetznerSingleNodeDeploymentProvider;

export declare const SINGLE_NODE_DEPLOYMENT_MODE: Readonly<{
  kind: 'single-node-systemd-user';
  version: 1;
}>;

export declare const SINGLE_NODE_MACHINE: Readonly<{
  class: 'small';
}>;

export interface SingleNodeDeploymentIntentInput {
  readonly deployment: {
    readonly id: string;
  };
  readonly appId: string;
  readonly target: SingleNodeDeploymentTarget;
  readonly mode: typeof SINGLE_NODE_DEPLOYMENT_MODE;
  readonly machine: typeof SINGLE_NODE_MACHINE;
  readonly access: {
    readonly kind: 'public-ssh';
    readonly allowedIpv4: readonly string[];
  };
  readonly provider: SingleNodeDeploymentProvider;
}

export interface SingleNodeDeploymentIntent extends SingleNodeDeploymentIntentInput {
  readonly schemaVersion: 1;
  readonly kind: 'singleNodeDeploymentIntent';
  readonly intentRevisionId: string;
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

export declare function createAwsSingleNodeDeploymentProvider(
  region: string,
): AwsSingleNodeDeploymentProvider;

export declare function createHetznerSingleNodeDeploymentProvider(
  location: string,
): HetznerSingleNodeDeploymentProvider;

export declare function createSingleNodeDeploymentIntent<const Input>(
  input: Input &
    SingleNodeDeploymentIntentInput &
    StrictShape<Input, SingleNodeDeploymentIntentInput>,
): Readonly<SingleNodeDeploymentIntent>;
