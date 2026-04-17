# Installation & Setup

## Installation

Wharfie is distributed as a single executable, and you can also install it from npm.

```bash
curl -fsSL https://raw.githubusercontent.com/wharfie/wharfie/master/install.sh | bash
```

For Windows:

```ps1
iex (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/wharfie/wharfie/master/install.ps1" -UseBasicParsing).Content
```

## Local v2 workflow

No extra cloud configuration is required for the core v2 authoring loop:

- `wharfie init`
- `wharfie app manifest`
- `wharfie app run`
- `wharfie app package`
- `wharfie ops`

## Optional legacy AWS deployment configuration

If you are working on the historical Wharfie v1 AWS deployment workflow, validate your AWS credentials first:

```bash
aws sts get-caller-identity
```

If that command returns a valid AWS identity, you are ready to continue. For configuring the AWS CLI refer to its [docs](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html)

Then write the legacy Wharfie deployment config:

```bash
wharfie config
```

You will need to choose the AWS region, deployment name, and service bucket used by the legacy deployment path. New v2 app/package workflows do not require this step.
