declare global {
  namespace NodeJS {
    interface Global {
      [key: symbol]: unknown;
      __wharfieWorkerInit?: {
        handlerInstalled: boolean;
        bundleLoaded: boolean;
      };
    }
  }
  var __WILLEM_BUILD_RECONCILE_TERMINATOR: boolean | undefined;
  var __wharfieWorkerInit:
    | {
        handlerInstalled: boolean;
        bundleLoaded: boolean;
      }
    | undefined;

  interface GlobalThis {
    [key: symbol]: unknown;
    __wharfieWorkerInit?: {
      handlerInstalled: boolean;
      bundleLoaded: boolean;
    };
  }
}

export {};
