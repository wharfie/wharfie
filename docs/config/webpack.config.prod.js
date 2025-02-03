const path = require('path');
const webpack = require('webpack');
const CopyPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const ESLintPlugin = require('eslint-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
const CssMinimizerPlugin = require('css-minimizer-webpack-plugin');
const { BundleAnalyzerPlugin } = require('webpack-bundle-analyzer');
const glamor = require('glamor/babel');
const autoprefixer = require('autoprefixer');
const postcssFlexbugsFixes = require('postcss-flexbugs-fixes');
const ImageMinimizerPlugin = require('image-minimizer-webpack-plugin');

process.env.NODE_ENV = 'production';
module.exports = {
  mode: process.env.NODE_ENV,

  // Generate source maps suitable for production
  devtool: 'source-map',

  // Entry point remains the same
  entry: './src/index.js',

  output: {
    // Clean the output directory before emit
    path: path.resolve(__dirname, '..', 'build'),
    // Use content hashes for better caching
    filename: 'static/js/[name].[contenthash].js',
    publicPath: '/',
    assetModuleFilename: 'static/media/[name].[hash][ext][query]',
  },

  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      assets: path.resolve(__dirname, '..', 'src/assets'),
      components: path.resolve(__dirname, '..', 'src/components'),
    },
    // Add extensions to resolve for better import statements
    extensions: ['.js', '.jsx', '.json'],
  },

  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        include: path.resolve(__dirname, '..', 'src'),
        loader: 'babel-loader',
        options: {
          cacheDirectory: true,
          presets: ['@babel/preset-env', '@babel/preset-react'],
          plugins: [
            () => glamor, // Satisfy Babel 7's requirement
          ],
        },
      },
      {
        test: /\.css$/,
        // Extract CSS into separate files
        use: [
          MiniCssExtractPlugin.loader,
          {
            loader: 'css-loader',
            options: {
              importLoaders: 1,
              sourceMap: false,
            },
          },
          {
            loader: 'postcss-loader',
            options: {
              postcssOptions: {
                ident: 'postcss',
                plugins: [
                  postcssFlexbugsFixes,
                  autoprefixer({
                    overrideBrowserslist: [
                      '>1%',
                      'last 4 versions',
                      'Firefox ESR',
                      'not ie < 9', // React doesn't support IE8 anyway
                    ],
                    flexbox: 'no-2009',
                  }),
                ],
              },
            },
          },
        ],
      },
      {
        test: /\.(png|jpe?g|gif|webp|svg)$/i,
        // type: "asset/resource",
        // generator: {
        //   filename: "static/media/[name].[ext]",
        // },
        type: 'javascript/auto',
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
    // Clean the build folder before each build
    new CleanWebpackPlugin(),
    new CopyPlugin({
      patterns: [
        path.resolve(__dirname, '..', 'public', 'manifest.json'),
        path.resolve(__dirname, '..', 'public', 'favicon.ico'),
      ],
    }),

    // Extract CSS into separate files
    new MiniCssExtractPlugin({
      filename: 'static/css/[name].[contenthash].css',
    }),

    // Generate an optimized index.html with injected scripts
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, '..', 'public', 'index.html'),
      minify: {
        removeComments: true,
        collapseWhitespace: true,
        removeRedundantAttributes: true,
        useShortDoctype: true,
        removeEmptyAttributes: true,
        removeStyleLinkTypeAttributes: true,
        keepClosingSlash: true,
        minifyJS: true,
        minifyCSS: true,
        minifyURLs: true,
      },
      templateParameters: {
        PUBLIC_URL: process.env.PUBLIC_URL || 'https://docs.wharfie.dev',
      },
    }),

    // Define environment variables
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV),
      'process.env.PUBLIC_URL': JSON.stringify(
        process.env.PUBLIC_URL || 'https:/docs.wharfie.dev'
      ),
    }),

    // Lint your code on build
    new ESLintPlugin({
      extensions: ['js', 'jsx'],
      emitWarning: false,
      emitError: true,
      failOnError: true,
    }),

    // Add BundleAnalyzerPlugin with specified options
    new BundleAnalyzerPlugin({
      openAnalyzer: false,
      reportFilename: path.resolve(__dirname, '..', 'report.html'),
      analyzerMode: 'static',
    }),

    new ImageMinimizerPlugin({
      // Minimizes the original images
      minimizer: {
        implementation: ImageMinimizerPlugin.imageminMinify,
        options: {
          plugins: [
            // ["gifsicle", { interlaced: true }],
            // ["jpegtran", { progressive: true }],
            // ["optipng", { optimizationLevel: 5 }],
            ['svgo', { plugins: [{ name: 'removeViewBox', active: false }] }],
          ],
        },
      },
      generator: [
        {
          preset: 'webp',
          implementation: ImageMinimizerPlugin.imageminGenerate,
          options: {
            plugins: [['imagemin-webp', { quality: 75 }]],
          },
        },
      ],
    }),
  ],

  optimization: {
    // Split vendor and common chunks
    splitChunks: {
      chunks: 'all',
      maxInitialRequests: Infinity,
      minSize: 0,
      cacheGroups: {
        // Vendor chunk for node_modules
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name(module) {
            // Get the name by extracting the package name
            const packageName = module.context.match(
              /[\\/]node_modules[\\/](.*?)([\\/]|$)/
            )[1];
            return `npm.${packageName.replace('@', '')}`;
          },
        },
        // Create separate chunks for each asynchronous import
        asyncChunks: {
          test: /[\\/]src[\\/]/,
          name(module) {
            // Extract the file name as the chunk name
            const filePath = module.identifier().split('!').pop();
            const fileName = path.basename(filePath, path.extname(filePath));
            return `async.${fileName}`;
          },
          chunks: 'async',
          priority: 10,
          reuseExistingChunk: false,
        },
      },
    },
    // Extract the runtime into a separate chunk
    runtimeChunk: 'single',
    // Minimize the output
    minimize: true,
    minimizer: [
      new TerserPlugin({
        parallel: true,
        terserOptions: {
          compress: {
            // Drop console statements
            drop_console: true,
          },
        },
      }),
      new CssMinimizerPlugin(),
    ],
  },

  // Remove devServer configuration as it's not needed in production
};
