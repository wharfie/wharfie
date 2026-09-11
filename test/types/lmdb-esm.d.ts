// LMDB 3.4.4's ESM declaration uses `export =`, which NodeNext rejects.
// This test-only declaration covers the native fixture's actual API until the
// upstream ESM declaration is corrected. Keep reads and values checked.
declare module 'lmdb' {
  export interface Database<Value> {
    put(key: string, value: Value): Promise<boolean>;
    get(key: string): Value | undefined;
    close(): Promise<void>;
  }

  const lmdb: {
    open<Value = unknown>(options: { path: string }): Database<Value>;
  };
  export default lmdb;
}
