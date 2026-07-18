export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

/**
 * A stable public identifier. Values must match
 * /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/ and contain at most 63 ASCII bytes.
 */
export type LogicalId = string;

export interface InvokeActivityOptions<
  Input extends JsonValue = JsonValue,
  CallerMetadata extends JsonObject = JsonObject,
> {
  /** JSON input delivered to the named activity. */
  input?: Input;
  /** JSON metadata identifying the caller without becoming activity input. */
  callerMetadata?: CallerMetadata;
  /** Positive safe Unix epoch milliseconds at which the attempt must stop. */
  deadlineUnixMs?: number;
  /** Source application directory. Ignored inside a packaged SEA. */
  dir?: string;
}

/** Stable identity for one physical activity attempt. */
export interface ActivityInvocation {
  readonly revisionId: string;
  readonly activityId: LogicalId;
  readonly runId: string;
  readonly invocationId: string;
  readonly attemptId: string;
  readonly fencingToken: string;
  readonly deadlineUnixMs?: number;
}

/** Trusted caller information carried separately from activity input. */
export interface ActivityCaller<Metadata extends JsonObject = JsonObject> {
  readonly metadata: Readonly<Metadata>;
}

export type ActivityLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

/** Structured activity logger. Log messages and fields must be JSON-safe. */
export interface ActivityLogger {
  log(level: ActivityLogLevel, message: string, fields?: JsonObject): void;
  trace(message: string, fields?: JsonObject): void;
  debug(message: string, fields?: JsonObject): void;
  info(message: string, fields?: JsonObject): void;
  warn(message: string, fields?: JsonObject): void;
  error(message: string, fields?: JsonObject): void;
}

/** The first durable effect exposed to application activities. */
export interface ApplicationStatePutIfAbsentEffectRequest<
  Value extends JsonValue = JsonValue,
> {
  readonly effectId: string;
  readonly capability: 'application-state';
  readonly operation: 'put-if-absent';
  readonly input: {
    readonly key: string;
    readonly value: Value;
  };
  readonly requestedReplayProperties: readonly ['idempotent', 'transactional'];
}

/** The exact logical result of an application-state put-if-absent effect. */
export interface ApplicationStatePutIfAbsentEffectResult {
  readonly inserted: boolean;
}

/** Host-mediated effects. A host without this capability rejects the request. */
export interface ActivityEffects {
  request<const Request extends ApplicationStatePutIfAbsentEffectRequest>(
    request: Request &
      StrictShape<Request, ApplicationStatePutIfAbsentEffectRequest>,
  ): Promise<ApplicationStatePutIfAbsentEffectResult>;
}

/** Runtime values supplied to an Activity Protocol v1 Node handler. */
export interface ActivityRuntime<
  CallerMetadata extends JsonObject = JsonObject,
> {
  readonly invocation: ActivityInvocation;
  readonly caller: ActivityCaller<CallerMetadata>;
  readonly signal: AbortSignal;
  readonly logger: ActivityLogger;
  readonly effects: ActivityEffects;
}

/** A named activity export: JSON input plus immutable invocation runtime. */
export type ActivityHandler<
  Input extends JsonValue = JsonValue,
  Result extends JsonValue = JsonValue,
  CallerMetadata extends JsonObject = JsonObject,
> = (
  input: Readonly<Input>,
  runtime: ActivityRuntime<CallerMetadata>,
) => Result | Promise<Result>;

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

export interface ActivityDefinition {
  entrypoint: NodeEntrypoint;
  /** Unique exact packages in ascending name order. */
  externalPackages?: readonly ExternalPackage[];
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
      platform: 'darwin';
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
  Input extends JsonValue = JsonValue,
  CallerMetadata extends JsonObject = JsonObject,
>(
  activityName: string,
  options?: InvokeActivityOptions<Input, CallerMetadata>,
): Promise<Result>;

declare const appApi: {
  defineApp: typeof defineApp;
  invokeActivity: typeof invokeActivity;
};

export default appApi;
