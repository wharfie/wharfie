process.env.NODE_ENV = 'development';

const webpack = require('webpack');
const WebpackDevServer = require('webpack-dev-server');
const config = require('../config/webpack.config.dev');

const compiler = webpack(config);

// Grab the devServer config from `webpack.config.dev.js`.
const { devServer } = config;

// Spin up webpack-dev-server in v4 style:
const server = new WebpackDevServer(devServer, compiler);

// Start listening on the configured port (default: 3000).
server.startCallback(() => {
  console.log(`\nDev server running at: http://localhost:${devServer.port}\n`);
});
