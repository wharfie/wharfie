# Apps

`apps/` stays top-level. It is the home for buildable Wharfie applications,
dogfood manifests, and reference artifacts that exercise the CLI/runtime end to
end.

`wharfie-cli` is an unshipped source prototype for an eventual self-hosting
builder. The supported builder currently runs from the npm package under the
pinned Node toolchain.

Current app examples should default-export the strict public manifest shape:

```js
export default {
  schemaVersion: 2,
  app: { id: 'example-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.js',
      export: 'main',
    },
  },
};
```

Use lowercase kebab IDs of at most 63 ASCII bytes. Examples must not author
`ActorSystem`, `functions`, `capabilities`, workflows, schedules, or build
secrets through this file. Add `targets` only when the example packages a SEA,
and add named `activities` or portable runtime `resources` only when the
example exercises them.
