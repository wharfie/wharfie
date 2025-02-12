#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const webpack = require('webpack');

// Path to your production Webpack configuration
const webpackConfigPath = path.resolve(
  __dirname,
  '..',
  'config',
  'webpack.config.prod.js'
);

// Check if the webpack.prod.js configuration exists
if (!fs.existsSync(webpackConfigPath)) {
  console.error('Error: webpack.prod.js configuration file not found.');
  process.exit(1);
}

// Import the production Webpack configuration
const webpackConfig = require(webpackConfigPath);

// Create a Webpack compiler instance
const compiler = webpack(webpackConfig);

// Function to format Webpack stats
const formatStats = (stats) => {
  return stats.toString({
    chunks: false, // Makes the build much quieter
    colors: true, // Shows colors in the console
    modules: false,
    children: false,
    entrypoints: false,
  });
};

// Run the Webpack build
compiler.run((err, stats) => {
  // Handle fatal errors (e.g., configuration errors)
  if (err) {
    console.error('Fatal error during the build:');
    console.error(err.stack || err);
    if (err.details) {
      console.error(err.details);
    }
    process.exit(1);
  }

  const info = stats.toJson();

  // Handle compilation errors (e.g., syntax errors)
  if (stats.hasErrors()) {
    console.error('Build failed with errors:');
    info.errors.forEach((error) => {
      console.error(error);
    });
    process.exit(1);
  }

  // Handle compilation warnings
  if (stats.hasWarnings()) {
    console.warn('Build completed with warnings:');
    info.warnings.forEach((warning) => {
      console.warn(warning);
    });
  }

  // Output the formatted stats
  console.log(formatStats(stats));

  console.log('✅  Build completed successfully.');
  process.exit(0);
});
