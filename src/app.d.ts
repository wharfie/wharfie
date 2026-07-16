export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * A stable public identifier. Values must match
 * /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/ and contain at most 63 ASCII bytes.
 */
export type LogicalId = string;

export interface InvokeActivityOptions<
  Event extends JsonValue = JsonValue,
  Context extends JsonObject = JsonObject,
> {
  event?: Event;
  context?: Context;
  /** Source application directory. Ignored inside a packaged SEA. */
  dir?: string;
}

export interface NodeEntrypoint {
  kind: 'node';
  path: string;
  export: string;
}

export interface AppCliDefinition {
  entrypoint: NodeEntrypoint;
}

export interface ExternalPackage {
  /** Lowercase npm registry package name. */
  name: string;
  /** An exact published semantic version, never a range or tag. */
  version: string;
}

export type DatabaseResourceSpec =
  | {
      adapter: 'vanilla';
      options?: { path?: string };
    }
  | {
      adapter: 'dynamodb';
      options?: { region?: string };
    };

export type QueueResourceSpec =
  | {
      adapter: 'vanilla';
      options?: { path?: string };
    }
  | {
      adapter: 'sqs';
      options?: { region?: string };
    };

export type ObjectStorageResourceSpec =
  | {
      adapter: 'vanilla';
      options?: { path?: string; region?: string };
    }
  | {
      adapter: 's3';
      options?: { region?: string };
    };

export interface AppResources {
  db?: DatabaseResourceSpec;
  queue?: QueueResourceSpec;
  objectStorage?: ObjectStorageResourceSpec;
}

export interface ActivityDefinition {
  entrypoint: NodeEntrypoint;
  /** Unique exact packages in ascending name order. */
  externalPackages?: readonly ExternalPackage[];
  resources?: AppResources;
}

interface AppTargetBase {
  /** Exact canonical semantic version in x.y.z form. */
  nodeVersion: string;
  architecture: 'arm64' | 'x64';
}

export type AppTarget =
  | (AppTargetBase & {
      platform: 'linux';
      libc: 'glibc';
    })
  | (AppTargetBase & {
      platform: 'darwin' | 'win32';
      libc?: never;
    });

export interface AppIdentity {
  id: LogicalId;
}

export interface WharfieAppDefinition {
  schemaVersion: 2;
  app: AppIdentity;
  cli: AppCliDefinition;
  targets?: readonly AppTarget[];
  resources?: AppResources;
  activities?: Readonly<Record<LogicalId, ActivityDefinition>>;
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

export declare function defineApp<const App>(
  definition: App &
    WharfieAppDefinition &
    StrictShape<App, WharfieAppDefinition>,
): App;

export declare function invokeActivity<
  Result extends JsonValue = JsonValue,
  Event extends JsonValue = JsonValue,
  Context extends JsonObject = JsonObject,
>(
  activityName: string,
  options?: InvokeActivityOptions<Event, Context>,
): Promise<Result>;

declare const appApi: {
  defineApp: typeof defineApp;
  invokeActivity: typeof invokeActivity;
};

export default appApi;
