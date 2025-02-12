// lqipModernLoader.js
const lqip = require('lqip-modern');
const { interpolateName, getOptions } = require('loader-utils');

module.exports = function lqipModernLoader(content) {
  // Mark this loader as async, so we can use Promises
  const callback = this.async();
  if (!callback) return content;

  // Get user loader options or use defaults
  const options = getOptions(this) || {};
  const fileBuffer = content; // A Buffer of the original file
  const context = this.rootContext;

  // Generate the placeholder (metadata) + possibly a small compressed version from lqip-modern
  lqip
    .default(fileBuffer, {
      resize: 20,
    })
    .then(({ metadata }) => {
      const name = interpolateName(
        this,
        options.name || 'static/media/[name].[hash].[ext]',
        {
          context,
          content: fileBuffer,
        }
      );

      // Let webpack know we want to emit the original file at `name`
      this.emitFile(name, fileBuffer);

      const publicPath = `__webpack_public_path__ + ${JSON.stringify(name)}`;
      const code = `
        module.exports = {
          src: ${publicPath},
          placeholder: ${JSON.stringify(metadata.dataURIBase64)},
          width: ${metadata.originalWidth},
          height: ${metadata.originalHeight}
        };
      `;

      callback(null, code);
    })
    .catch((err) => {
      callback(err);
    });
};
module.exports.raw = true;
