// transform-markdown-images-loader.js
const cheerio = require('cheerio');

module.exports = function transformMarkdownImages(source) {
  const callback = this.async(); // Mark loader as async
  const $ = cheerio.load(source);

  const imgElements = $('img').toArray();

  // For each <img>, we do an async operation to load the image via Webpack
  const tasks = imgElements.map((imgEl) => {
    const $img = $(imgEl);
    const originalSrc = $img.attr('src');
    if (!originalSrc) return Promise.resolve();

    // We'll interpret the relative path + query with Webpack
    return new Promise((resolve, reject) => {
      // 1) Resolve the path with Webpack's built-in resolver
      this.resolve(this.context, originalSrc, (err, resolvedPath) => {
        if (err) return reject(err);

        // 2) Now load that resolved path. This passes it to your webp loader (etc.)
        this.loadModule(resolvedPath, (err, sourceCode) => {
          if (err) return reject(err);

          // Build a small wrapper that defines __webpack_public_path__ before the code
          const publicPath =
            typeof this._compiler?.options?.output?.publicPath === 'string'
              ? this._compiler.options.output.publicPath
              : '';

          // We'll define a small IIFE that sets the variable, sets up a module.exports,
          // runs the code, and returns module.exports at the end.
          const wrappedCode = `
            var __webpack_public_path__ = '${publicPath}';
            var module = { exports: {} };
            ${sourceCode}
            return module.exports;
          `;

          let exportsObj;
          try {
            // Evaluate the code to retrieve the final object your image loader exports
            // eslint-disable-next-line no-new-func
            exportsObj = new Function(wrappedCode)();
          } catch (e) {
            return reject(e);
          }

          // The object might look like: { src, placeholder, width, height }
          if (exportsObj && exportsObj.src) {
            // Use placeholder as initial "blurred" src, or fallback to real src
            $img.attr('src', exportsObj.placeholder || exportsObj.src);
            // Store the real image in data-fullsrc
            $img.attr('data-fullsrc', exportsObj.src);
            $img.attr('width', exportsObj.width);
            $img.attr('height', exportsObj.height);
            // $img.attr("aspect-ratio", exportsObj.width/exportsObj.height);
            // The onload swap
            const onloadScript = `(function(e){if(navigator.userAgent!=='ReactSnap'){e.onload=null;(async function(){try{var t=e.dataset.fullsrc;if(!t)return;var i=await(function(u){return new Promise(function(r,n){var a=new Image;a.onload=function(){r(a)},a.onerror=n,a.src=u})})(t);i.decode&&await i.decode();e.src=t}catch(s){console.error('Failed to preload image:',s)}})()}})(this)`;
            $img.attr('onload', onloadScript);

            const $parentP = $img.parent('p');
            if ($parentP.length) {
              // Calculate aspect ratio in % for a responsive container
              const aspectRatioPercent =
                (exportsObj.height / exportsObj.width) * 100;
              $parentP.attr(
                'style',
                `position: relative; width: 100%; padding-top: ${aspectRatioPercent}%;`
              );
            }
          }

          resolve();
        });
      });
    });
  });

  // Once all images are processed, return the modified HTML
  Promise.all(tasks)
    .then(() => callback(null, $.html()))
    .catch(callback);
};
