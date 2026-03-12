declare module 'semver' {
  export function valid(version: string): string | null;
  export function gt(version: string, otherVersion: string): boolean;

  const semver: {
    valid: typeof valid;
    gt: typeof gt;
  };

  export default semver;
}
