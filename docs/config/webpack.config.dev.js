const path = require('path');
const glamor = require('glamor/babel');
const webpack = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const BuildSearchIndexPlugin = require('./build-search-index-plugin');

process.env.NODE_ENV = 'development';
module.exports = {
  mode: process.env.NODE_ENV,
  devtool: 'eval-source-map',

  // Your main entry file(s):
  entry: [
    // webpack/hot/dev-server is typically included automatically by devServer.hot = true,
    // but you can add it explicitly if you like. It's optional in Webpack 5.
    './src/index.js',
  ],

  output: {
    // Output to /build (or wherever you prefer).
    path: path.resolve(__dirname, '..', 'build'),
    filename: 'static/js/bundle.js',
    publicPath: '/',
    devtoolModuleFilenameTemplate: (info) =>
      'webpack:///' +
      path
        .relative(
          path.resolve(__dirname, '..', 'src'),
          info.absoluteResourcePath
        )
        .replace(/\\/g, '/'),
  },

  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      assets: path.resolve(__dirname, '..', 'src/assets'),
      components: path.resolve(__dirname, '..', 'src/components'),
    },
  },

  // Dev server settings for hot reloading, etc.
  devServer: {
    port: 3000,
    hot: true,
    historyApiFallback: true,
    open: true,
  },

  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        include: path.resolve(__dirname, '..', 'src'),
        loader: require.resolve('babel-loader'),
        options: {
          cacheDirectory: true,
          presets: ['@babel/preset-env', '@babel/preset-react'],
          plugins: [
            () => glamor, // <-- satisfy babel 7's requirement of plugins being function
          ],
        },
      },
      {
        test: /\.css$/,
        use: [require.resolve('style-loader'), require.resolve('css-loader')],
      },
      {
        test: /\.(png|jpe?g|gif|svg|webp)$/i,
        use: [
          {
            loader: path.resolve(__dirname, 'lqip-modern-loader.js'), // or wherever you placed it
            options: {
              // You can keep the same naming pattern as before:
              name: 'static/media/[name].[hash].[ext]',
            },
          },
        ],
      },
      {
        test: /\.md$/,
        use: [
          {
            // 3) Final pass: let html-loader parse any remaining references
            loader: 'html-loader',
            options: {
              sources: {
                list: [
                  {
                    tag: 'img',
                    attribute: 'src',
                    type: 'src',
                  },
                ],
              },
            },
          },
          {
            // 2) Your custom loader that rewrites <img> tags
            loader: path.resolve(
              __dirname,
              'transform-markdown-images-loader.js'
            ),
          },
          {
            // 1) Convert Markdown to HTML
            loader: 'markdown-loader',
            options: {
              highlight(code) {
                return require('highlight.js').highlightAuto(code).value;
              },
            },
          },
        ],
      },
    ],
  },

  plugins: [
    new BuildSearchIndexPlugin(),
    // Generates an index.html with the <script> injected.
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '..', 'public', 'index.html'),
      templateParameters: {
        PUBLIC_URL: process.env.PUBLIC_URL || 'http://localhost:3000', // Pass PUBLIC_URL to the template
      },
    }),
    // Define environment variables
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.env.PUBLIC_URL': JSON.stringify(
        process.env.PUBLIC_URL || 'http://localhost:3000'
      ),
    }),
    // Lint your code on build
    new ESLintPlugin({
      extensions: ['js', 'jsx'],
    }),
  ],
};
