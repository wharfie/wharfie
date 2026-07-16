import {
  defineApp,
  invokeActivity,
  type JsonObject,
} from '@wharfie/wharfie/app';

const app = defineApp({
  name: 'typed-app',
  cli: { entrypoint: './src/cli.ts', export: 'main' },
  targets: [
    {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'arm64',
      libc: 'glibc',
    },
  ],
  activities: {
    greet: {
      entrypoint: { path: './src/greet.ts', export: 'greet' },
      external: [{ name: 'example-package', version: '1.2.3' }],
    },
  },
});

const appName: string = app.name;
void appName;

interface GreetResult extends JsonObject {
  message: string;
}

const result = await invokeActivity<GreetResult, { name: string }>('greet', {
  event: { name: 'typed-user' },
});

const message: string = result.message;
void message;
