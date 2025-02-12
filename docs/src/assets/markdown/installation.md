# Installation & Setup

## Installation

Wharfie is distributed as a single executable, you can download a specific release from the github releases

```bash
curl -fsSL https://raw.githubusercontent.com/wharfie/wharfie/master/install.sh | bash
```

For Windows:

```ps1
iex (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/wharfie/wharfie/master/install.ps1" -UseBasicParsing).Content
```

## Validate AWS credentials

```bash
aws sts get-caller-identity
```

If that command returns a valid aws identity, you are ready to continue. For configuring the AWS CLI refer to its [docs](https://docs.aws.amazon.com/cli/v1/userguide/cli-chap-configure.html)

## Configure Wharfie CLI

```bash
wharfie config
```

You will need to select what AWS region to deploy wharfie in, as a rule of thumb running wharfie in the same region that your data is stored in will be cheaper, due to transfer costs. You will also need to select a wharfie deployment name which will be how you target what specific deployment you will use when running wharfie cli commands. For more information on deployments refer to the [project structure docs](./project-structure)
