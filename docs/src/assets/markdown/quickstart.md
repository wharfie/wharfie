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

## Create Deployment

```bash
wharfie deployment create
```

## Initalize Project

```bash
wharfie project init
```

## Plan and Apply Project Change

after cd'ing into the new project directory created by init

```bash
wharfie project plan
```

will show you what changes will be made when you run apply

```bash
wharfie project apply
```
