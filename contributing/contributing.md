# Contributing to Wharfie

Work in a Git checkout. Start with [PROJECT.md](../PROJECT.md) for the product
contract and [ROADMAP.md](../ROADMAP.md) for current priorities. Preserve any
unrelated changes already in the working tree.

## Set up the pinned toolchain

Contributors use the exact Node version in `.nvmrc` and npm version in
`package.json#packageManager`. With nvm available, run these commands from the
checkout root:

```sh
nvm install
nvm use
wharfie_npm_pin="$(node --print 'require("./package.json").packageManager')"
(cd "${TMPDIR:-/tmp}" && npm install --global "$wharfie_npm_pin")
npm ci
```

The npm bootstrap runs outside the checkout because the repository's
`devEngines` rejects npm versions other than its exact pin. `npm ci` installs
the committed lockfile, including the AWS companion workspace. Re-run it after
switching Node versions or changing the dependency lockfile. Consumer Node
support is defined separately by `package.json#engines`.

## Run the checkout's CLI

```sh
node ./bin/wharfie --help
node ./bin/wharfie app manifest .
```

Invoke the local launcher directly; a global Wharfie installation is not
required. The supported [hello-world starter](../examples/hello-world/README.md)
teaches application authoring and sharing. Persistent deployment uses the
[packaged application operator](../docs/guides/installation.md), including
AWS and Hetzner when the selected artifact carries the needed capability.

## Validate a change

Use a focused suite while editing:

```sh
npm test -- --runInBand test/app-api.test.js
```

The complete ordinary merge gate is:

```sh
npm run test:ci
```

It runs lint/format checks, all four TypeScript programs, coverage thresholds,
package-content verification, provider-boundary verification, and the production
dependency audit. It requires registry access for the package/provider checks
and audit. `npm test` alone is coverage-free.

Native dependencies, generated executables, and real systemd/cloud behavior
have separate checks. Run the ones relevant to the change and distinguish a
local pass from hosted Linux or live-provider evidence. The
[development validation guide](../docs/guides/development-validation.md)
defines each gate, its exclusions, and failure diagnostics.

Application examples meant for users belong in `examples/`. Repository-only
application fixtures belong in `test/fixtures/apps/` and participate in test
linting and typechecking. Keep generated artifacts and disposable state out
of tracked source.

## Review handoff

Keep changes on a task branch. Explain the problem, resulting behavior, and
validation in the pull request, including any check that failed or could not
run. Review `git diff --check` and the final diff before committing. The
[prompt templates](../llm/prompts/README.md) use this same checkout workflow.
