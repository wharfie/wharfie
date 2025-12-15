/* eslint-disable node/no-unsupported-features/node-builtins */
if (process.env.NODE_ENV !== 'test') {
  // @ts-ignore
  process.report.reportOnFatalError = true;
  // @ts-ignore
  process.report.reportOnSignal = true;
  // @ts-ignore
  process.report.reportOnUncaughtException = true;
  // @ts-ignore
  process.report.filename = 'stderr';
}
