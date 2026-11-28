# Wharfie

<img src="./docs/assets/beanie.svg" align="right" alt="" width="78">

Wharfie turns a TypeScript or JavaScript CLI into an executable you can share.
Run it with ordinary arguments, or give it a workflow and let a trusted Linux
server keep that work running after you disconnect. The builder uses Node;
the person running the executable doesn't need Node or your source tree.

[Documentation](https://docs.wharfie.dev/) · [Published preview](https://github.com/wharfie/wharfie/releases/tag/v0.0.17) · [CI](https://github.com/wharfie/wharfie/actions/workflows/ci.yml)

## Try it

On macOS or glibc Linux, use Node 24.13.1 and the starter from the published
preview. From an empty directory:

```sh
git clone --depth 1 --branch v0.0.17 https://github.com/wharfie/wharfie.git
cd wharfie/examples/hello-world
npm install
npm run hello -- Ada
npm run package
```

The CLI prints `Hello, Ada!`. Packaging prints a `Next:` command for the
executable it built. Run that command with `Ada` as its argument to get the
same greeting from the binary.

**To keep work running:** [build, share, and run the preview](docs/guides/recipient-preview.md).
That guide runs two file checks a minute apart. Close the submitting shell
between checks, reconnect, and inspect the result of the same run.

## Preview limits

Use sample data on a trusted host. Each executable targets one platform and
architecture; persistent services require Linux with a systemd user manager.
The preview supports a single host, including AWS or Hetzner. A crash can
require explicit recovery, and destroying a cloud host deletes its root-disk
data. See the [known issue and workarounds for v0.0.17](docs/guides/recipient-preview.md#known-issue-operator-commands-while-the-service-writes).

## Find your next step

- [Quickstart](docs/guides/quickstart.md) — see how the hello-world CLI and its manifest fit together.
- [Installation](docs/guides/installation.md) — choose a builder, target, and release channel. The preview is separate from npm's `latest`.
- [CLI and runtime reference](docs/guides/cli-reference.md) — package an app, operate a service, or inspect and recover work.
- [Contributing](contributing/contributing.md) · [Roadmap](ROADMAP.md) · [Architecture decisions](docs/architecture/decisions/README.md) · [Implementation checkpoints](llm/checkpoints/)
- [Give preview feedback](https://github.com/wharfie/wharfie/issues/new?template=preview-feedback.yml)
