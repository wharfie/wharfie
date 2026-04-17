# ⚡️ Quickstart

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/wharfie/wharfie/master/install.sh | bash
```

For Windows:

```ps1
iex (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/wharfie/wharfie/master/install.ps1" -UseBasicParsing).Content
```

## Initialize a v2 App

```bash
wharfie init my_app
```

The default scaffold creates a runnable v2 app with:

- `package.json`
- `wharfie.app.js`
- `src/cli.js`
- `src/activities/hello.js`
- `README.md`

Use `--no-examples` if you want the minimal scaffold without the sample workflow/scheduler blocks. Use `--template legacy-v1` only when you are working on the historical Athena/table-oriented workflow.

## Inspect an App Manifest

```bash
wharfie app manifest ./my_app
```

## Run a Local App Activity

```bash
wharfie app run hello --dir ./my_app --event '{"who":"cli-user"}'
```

## Package an App

```bash
wharfie app package ./my_app
```

## Create a Persisted Local Run

`wharfie ops` stores and executes persisted operation runs against the same app manifest:

```bash
wharfie ops run --activity hello --dir ./my_app --event '{"who":"cli-user"}'
```

The shipped top-level CLI surface today is `init`, `app`, `ops`, `list`, `build-self`, and `config` (legacy AWS deployment setup only).
