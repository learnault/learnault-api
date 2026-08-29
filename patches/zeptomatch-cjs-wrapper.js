const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

// Resolve the ESM entry point from the real zeptomatch package
const esmPath = require.resolve('zeptomatch/dist/index.js', { paths: __dirname });

let cached = null;

async function loadZeptomatch() {
  if (cached) return cached;
  const mod = await import(pathToFileURL(esmPath).href);
  cached = mod.default;
  return cached;
}

// Synchronous wrapper that returns a thenable matching zeptomatch's API.
// Prisma only uses zeptomatch synchronously (compile + test), so we can
// eagerly load the module at require-time using import().
const zeptomatchSync = (glob, path, options) => {
  throw new Error('zeptomatch-cjs: async-only mode; use the ESM entry point');
};

module.exports = zeptomatchSync;
module.exports.default = zeptomatchSync;

// Pre-load in background so it's ready for synchronous use
loadZeptomatch().then(fn => {
  module.exports = fn;
  module.exports.default = fn;
}).catch(() => {});
