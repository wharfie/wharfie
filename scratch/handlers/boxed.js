const boxednode = require('boxednode');
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const pkgUp = require('pkg-up');
process.env.DISABLE_TURBO_CALLS = true;
const nativeNodeModulesPlugin = {
  name: 'native-node-modules',
  setup(build) {
    // If a ".node" file is imported within a module in the "file" namespace, resolve
    // it to an absolute path and put it into the "node-file" virtual namespace.
    build.onResolve({ filter: /\.node$/, namespace: 'file' }, (args) => ({
      path: require.resolve(args.path, { paths: [args.resolveDir] }),
      namespace: 'node-file',
    }));

    // Files in the "node-file" virtual namespace call "require()" on the
    // path from esbuild of the ".node" file in the output directory.
    build.onLoad({ filter: /.*/, namespace: 'node-file' }, (args) => ({
      contents: `
          import path from ${JSON.stringify(args.path)}
          try { module.exports = require(path) }
          catch {}
        `,
    }));

    // If a ".node" file is imported within a module in the "node-file" namespace, put
    // it in the "file" namespace where esbuild's default loading behavior will handle
    // it. It is already an absolute path since we resolved it to one above.
    build.onResolve({ filter: /\.node$/, namespace: 'node-file' }, (args) => ({
      path: args.path,
      namespace: 'file',
    }));

    // Tell esbuild's default loading behavior to use the "file" loader for
    // these ".node" files.
    const opts = build.initialOptions;
    opts.loader = opts.loader || {};
    opts.loader['.node'] = 'file';
  },
};

(async () => {
  try {
    console.log('Starting compilation...');
    await esbuild.build({
      stdin: {
        contents: fs.readFileSync(
          path.join(__dirname, 'helloworld.js'),
          'utf8'
        ),
        resolveDir: __dirname,
        sourcefile: 'index.js',
      },
      outfile: path.join(__dirname, 'esbundle.js'),
      bundle: true,
      platform: 'node',
      minify: false,
      keepNames: true,
      sourcemap: 'inline',
      target: 'node22',
      external: ['actual-crash', 'lmdb', 'msgpackr-extract'],
      // loader: { '.html': 'text', '.node': 'file' },
      // plugins: [nativeNodeModulesPlugin],
    });
    await boxednode.compileJSFileAsBinary({
      sourceFile: path.join(__dirname, 'esbundle.js'),
      targetFile: path.join(__dirname, 'boxed'),
      nodeVersionRange: '22',
      //   env: {
      //     DISABLE_TURBO_CALLS: 'true'
      //   },
      addons: [
        {
          path: path.dirname(
            await pkgUp({ cwd: require.resolve('actual-crash') })
          ),
          requireRegexp: /actual-crash$/,
        },
        {
          path: path.dirname(await pkgUp({ cwd: require.resolve('lmdb') })),
          requireRegexp: /lmdb$/,
        },
        // {
        //   path: path.dirname(await pkgUp({ cwd: require.resolve('msgpackr-extract') })),
        //   requireRegexp: /msgpackr-extract$/
        // }
      ],
    });
    console.log('Compilation successful.');
  } catch (error) {
    console.error('Compilation failed:', error);
  }
})();
