const glamor = require('glamor/babel');

module.exports = {
  presets: ['@babel/preset-env', '@babel/preset-react'],
  plugins: [
    () => glamor, // <-- satisfy babel 7's requirement of plugins being function
  ],
};
