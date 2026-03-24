# ⚡️ Quickstart

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/wharfie/wharfie/master/install.sh | bash
```

For Windows:

```ps1
iex (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/wharfie/wharfie/master/install.ps1" -UseBasicParsing).Content
```

## Configure

```bash
wharfie config
```

## Initialize a Project

```bash
wharfie init my_project
```

`wharfie init` creates a local project scaffold with `wharfie.yaml`, `sources/`, and `models/`. Add `--no-examples` if you want an empty scaffold.

## Inspect an App Manifest

Once you have a `wharfie.app.js`, you can inspect the compiled manifest locally:

```bash
wharfie app manifest ./path/to/wharfie.app.js
```

## Run a Local App Function

```bash
wharfie app run <function_name> --dir ./path/to/app --event '{"who":"cli-user"}'
```

The shipped top-level CLI surface today is `config`, `init`, `app`, `ops`, `list`, and `build-self`.
