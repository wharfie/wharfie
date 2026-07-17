declare module 'semver' {
  export function valid(version: string): string | null;
  export function validRange(range: string): string | null;
  export function satisfies(version: string, range: string): boolean;
  export function gt(version: string, otherVersion: string): boolean;

  const semver: {
    valid: typeof valid;
    validRange: typeof validRange;
    satisfies: typeof satisfies;
    gt: typeof gt;
  };

  export default semver;
}
