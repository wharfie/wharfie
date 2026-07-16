export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export interface InvokeActivityOptions<
  Event extends JsonValue = JsonValue,
  Context extends JsonObject = JsonObject,
> {
  event?: Event;
  context?: Context;
  /** Source application directory. Ignored inside a packaged SEA. */
  dir?: string;
}

export interface AppEntrypoint {
  path: string;
  export?: string;
}

export interface AppCliDefinition {
  entrypoint: string;
  export?: string;
}

export interface ExternalDependency {
  name: string;
  /** An exact published semantic version, never a range or tag. */
  version: string;
}

export interface ResourceSpec {
  adapter: string;
  options?: JsonObject;
}

export interface AppResources {
  db?: string | ResourceSpec;
  queue?: string | ResourceSpec;
  objectStorage?: string | ResourceSpec;
}

export interface ActivityDefinition {
  entrypoint: AppEntrypoint;
  external?: Array<string | ExternalDependency>;
  resources?: AppResources;
}

export interface AppTarget {
  nodeVersion: string;
  platform: 'darwin' | 'linux' | 'win32';
  architecture: 'arm64' | 'x64';
  libc?: 'glibc';
}

export interface WharfieAppDefinition {
  /** Lowercase portable identifier used in artifact and durable identities. */
  name: string;
  cli?: AppCliDefinition;
  targets?: AppTarget[];
  resources?: AppResources;
  activities?: Record<string, ActivityDefinition>;
}

export declare function defineApp<const App extends WharfieAppDefinition>(
  definition: App,
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
