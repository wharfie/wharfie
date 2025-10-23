import vm from 'node:vm';

const sandbox = {
  process: {
    env: {
      npm_config_platform: 'what',
      npm_config_arch: 'x64',
    },
  },
  console,
  //   require,
};
vm.createContext(sandbox);

const script = new vm.Script(`
  console.log("platform:", process.env.npm_config_platform);
`);
script.runInContext(sandbox);
