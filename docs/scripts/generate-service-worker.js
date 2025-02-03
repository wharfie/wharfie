#!/usr/bin/env node

const workboxBuild = require('workbox-build');

async function buildSW() {
  try {
    const { count, size, warnings } = await workboxBuild.generateSW({
      // Where to look for your final assets.
      globDirectory: 'build',
      // Which files to precache (adjust to your needs).
      globPatterns: ['**/*.{html,js,css,json,svg,png,jpg,jpeg,gif,webp}'],

      // Where to output the generated SW file.
      swDest: 'build/service-worker.js',

      // Optionally limit large files: 5 MB here.
      maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,

      // Basic SW configuration.
      clientsClaim: true,
      skipWaiting: true,
      cleanupOutdatedCaches: true,

      // Single-page app fallback (if relevant).
      navigateFallback: '/index.html',
      // For example, do not fallback on /api calls.
      navigateFallbackDenylist: [/^\/api/],

      // Runtime caching rules.
      runtimeCaching: [
        {
          // Cache images aggressively.
          urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'images',
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 30 * 24 * 60 * 60, // 30 Days
            },
          },
        },
        {
          // Cache your domain's fetch calls more gently (NetworkFirst).
          urlPattern: new RegExp('^https://docs\\.wharfie\\.dev/'),
          handler: 'NetworkFirst',
          options: {
            cacheName: 'api',
            networkTimeoutSeconds: 10,
            expiration: {
              maxEntries: 50,
              maxAgeSeconds: 5 * 60, // 5 Minutes
            },
            cacheableResponse: {
              statuses: [0, 200],
            },
          },
        },
        // Add more runtime caching rules as needed...
      ],
    });

    if (warnings && warnings.length) {
      console.warn('Warnings encountered while generating the service worker:');
      for (const warning of warnings) {
        console.warn('⚠️  ' + warning);
      }
    }
    console.log(
      `Generated service-worker.js, which will precache ${count} files (${(
        size / 1024
      ).toFixed(2)} KB)`
    );
  } catch (err) {
    console.error('❌ Workbox build failed:', err);
    process.exit(1);
  }
}

buildSW();
