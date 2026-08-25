# Wharfie Application Structure

Wharfie applications are normal TypeScript or JavaScript projects with a
developer-owned CLI and a `wharfie.app.js` manifest. The smallest manifest is
`defineApp({ id, main })`; named activities, exact external-package pins, and an
explicit cross-target package matrix are optional. When targets are omitted,
packaging selects the exact compatible host.

See the current [Application Structure](../docs/guides/application-structure.md)
guide for a minimal layout and commands that work against the shipped CLI.
