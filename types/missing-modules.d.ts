declare module 'chalk' {
  const chalk: any;
  export default chalk;
}

declare module 'jszip' {
  const JSZip: any;
  export default JSZip;
}

declare module 'esbuild' {
  export const build: any;
  const esbuild: any;
  export default esbuild;
}

declare module 'tar' {
  export const c: any;
  export const x: any;
  export const extract: any;
  const tar: any;
  export default tar;
}

declare module 'postject' {
  export const inject: any;
}

declare module '@grpc/grpc-js' {
  export const Client: any;
  export const Metadata: any;
  export const Server: any;
  export const ServerCredentials: any;
  export const credentials: any;
}

declare module 'node-ssh' {
  export const NodeSSH: any;
}

declare module '@smithy/util-retry' {
  export const ConfiguredRetryStrategy: any;
}
