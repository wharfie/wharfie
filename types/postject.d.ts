declare module 'postject' {
  export type InjectOptions = {
    sentinelFuse?: string;
    machoSegmentName?: string;
  };

  export function inject(
    filename: string,
    resourceName: string,
    resource: Uint8Array,
    options?: InjectOptions,
  ): Promise<void>;
}
