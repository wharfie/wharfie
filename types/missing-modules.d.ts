declare module 'chalk' {
  const chalk: any;
  export = chalk;
}

declare module 'jszip' {
  interface JSZipFile {
    async(type: string): Promise<Buffer>;
  }

  class JSZip {
    files: Record<string, JSZipFile>;
    file(path: string, contents: string | Buffer): void;
    generateAsync(options: Record<string, any>): Promise<Buffer>;
    loadAsync(data: Buffer | Uint8Array | ArrayBuffer): Promise<JSZip>;
  }
  export = JSZip;
}

declare module 'esbuild' {
  export type BuildOutputFile = {
    path: string;
    text: string;
    contents?: Uint8Array;
  };

  export interface BuildResult {
    outputFiles?: BuildOutputFile[];
    [key: string]: any;
  }

  export interface BuildOptions {
    stdin?: Record<string, any>;
    write?: boolean;
    [key: string]: any;
  }

  export function build(options: BuildOptions): Promise<BuildResult>;

  const esbuild: {
    build: typeof build;
  };

  export default esbuild;
}

declare module 'tar' {
  export const c: any;
  export const x: any;
  export const extract: any;
  const tar: any;
  export = tar;
}

declare module 'postject' {
  export function inject(...args: any[]): Promise<any>;
}

declare module '@grpc/grpc-js' {
  export type ServiceDefinition<T = any> = Record<string, any>;
  export type UntypedServiceImplementation = Record<string, any>;

  export class Client {
    constructor(address: string, credentials: any, options?: any);
    close(): void;
    makeUnaryRequest(
      path: string,
      serialize: (value: any) => Buffer,
      deserialize: (value: Buffer) => any,
      request: any,
      metadata: any,
      options: any,
      callback: (err: any, response: any) => void,
    ): void;
  }

  export class Metadata {
    constructor();
  }

  export class Server {
    constructor();
    addService(
      serviceDefinition: ServiceDefinition<any>,
      implementation: any,
    ): void;
    bindAsync(
      address: string,
      credentials: any,
      callback: (err: Error | null, actualPort: number) => void,
    ): void;
    tryShutdown(callback: () => void): void;
  }

  export class ServerCredentials {
    static createInsecure(): any;
  }

  export const credentials: {
    createInsecure(): any;
  };
}

declare module 'node-ssh' {
  export class NodeSSH {
    [key: string]: any;
  }
}

declare module '@smithy/util-retry' {
  export class ConfiguredRetryStrategy {
    constructor(
      maxAttempts: number | (() => Promise<number>),
      computeNextBackoffDelay?: (attempt: number) => number,
    );
  }
}

declare module '@smithy/types' {
  export type ResponseMetadata = Record<string, any>;
  export type MetadataBearer = { $metadata?: ResponseMetadata };
  export type Provider<T> = T | (() => Promise<T>);
  export type HttpHandlerOptions = Record<string, any>;
  export type RetryStrategy = any;
  export type RetryStrategyV2 = any;
  export type RetryToken = any;
  export type StandardRetryToken = any;
  export type RetryErrorInfo = any;
  export type Logger = any;
  export type ParsedIniData = Record<string, any>;
  export type IniSection = Record<string, any>;
  export type AwsCredentialIdentity = Record<string, any>;
  export type AwsCredentialIdentityProvider = Provider<AwsCredentialIdentity>;
  export type UserAgent = any;
  export type Endpoint = any;
  export type EndpointV2 = any;
  export type RuleSetObject = any;
  export type BodyLengthCalculator = any;
  export type StreamCollector = any;
  export type HashConstructor = any;
  export type Decoder = any;
  export type Encoder = any;
  export type UrlParser = any;
  export type RequestSigner = any;
  export type AuthScheme = any;
  export type HttpAuthScheme = any;
  export type ClientProtocol<I = any, O = any> = any;
  export type ClientProtocolCtor<I = any, O = any> = any;
}

declare module 'node-sql-parser/build/athena' {
  export class Parser {
    parse(sql: string): { tableList?: string[] };
  }
}

declare module 'cli-table3' {
  class Table {
    constructor(options?: Record<string, any>);
    push(...rows: any[]): number;
    toString(): string;
  }

  export = Table;
}

declare module 'jsondiffpatch' {
  export type Delta = any;

  export function diff(left: any, right: any): Delta | undefined;

  export const formatters: {
    console: {
      format(delta: Delta, left: any): string;
    };
  };

  const jsondiffpatch: {
    diff: typeof diff;
    formatters: typeof formatters;
  };

  export default jsondiffpatch;
}

declare module 'lmdb' {
  export interface LMDBStore {
    get(key: any): any;
    getRange(options: Record<string, any>): Iterable<{ key?: any; value: any }>;
    putSync(key: any, value: any): any;
    removeSync(key: any): any;
    close?(): void | Promise<void>;
  }

  export interface LMDBEnvironment {
    openDB(options: Record<string, any>): LMDBStore;
    committed?: Promise<any>;
    flushed?: Promise<any>;
    close?(): void | Promise<void>;
  }

  export function open(options: Record<string, any>): LMDBEnvironment;
}

declare module 'env-paths' {
  export interface EnvPaths {
    data: string;
    config: string;
    cache: string;
    log: string;
    temp: string;
  }

  export interface EnvPathsOptions {
    suffix?: string;
  }

  export default function envPaths(
    name: string,
    options?: EnvPathsOptions,
  ): EnvPaths;
}
