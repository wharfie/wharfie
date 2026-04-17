<h1 align="center">
  <img src="../images/beanie.png?as=webp" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
</h1>

Wharfie is a manifest-first framework for packaging developer-owned Node CLIs and named activities into single executable artifacts.

A Wharfie app lives in `wharfie.app.js` and can declare a CLI, activities, explicit runtime resources, optional workflows, optional cron triggers, and build targets. The shipped CLI is centered on `wharfie init`, `wharfie app`, `wharfie ops`, `wharfie list`, and `wharfie build-self`. `wharfie config` is only for legacy AWS deployment workflows.

### ⚡️ Quickstart

#### Install

```bash
curl -fsSL https://raw.githubusercontent.com/wharfie/wharfie/master/install.sh | bash
```

For Windows:

```ps1
iex (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/wharfie/wharfie/master/install.ps1" -UseBasicParsing).Content
```

#### Example

```bash
wharfie init my_app
wharfie app manifest ./my_app
wharfie app run hello --dir ./my_app --event '{"who":"docs-user"}'
wharfie app package ./my_app
```

### Legacy: Wharfie v1

Wharfie v1 was the original Athena/table-oriented product organized around `sources/` and `models/`. That shape remains available behind `wharfie init --template legacy-v1`, but it is not the default Wharfie story anymore.

For more follow the [QuickStart Guide](/quickstart), the [Legacy: Wharfie v1 guide](/legacy-v1), or [Mapping Wharfie v1 onto v2](/v1-on-v2).
