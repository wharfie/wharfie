#!/usr/bin/env python3
"""Local operator. Only explicit subcommands perform remote changes.

Never run `apply`, `token`, `start`, `authorize`, or `teardown` before review.
All AWS CLI inputs use private JSON files, not shell interpolation.
"""
import argparse
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

from template import render, runtime_bundle, RUNTIME_FILES
from supervisor import (atomic_json, read_json, MAX_JSON, never_created_evidence, soak_hours,
                        latest_start, SETUP_BUDGET)

HERE = Path(__file__).resolve().parent
ACCOUNT = '411430101559'
# Consecutive watch cycles with a failed read before `authorize` stops, and the
# longest period without a fully successful cycle.
MAX_POLL_FAILURES = 10
MAX_POLL_FAILURE_SECONDS = 900
# Least time `prepare` must leave before `latest_start` for apply, bootstrap,
# token, and start. Measured: 9 min on 2026-11-05 and 46 min on 2026-11-19.
PROVISION_BUDGET = 3600
# Least time a stack-creating `apply` must leave before `latest_start` so that
# `start` can still follow. Measured apply to start: 10 m 55 s on 2026-11-19.
APPLY_START_MARGIN = 1200
DEFAULT_SSM_KEY = 'alias/aws/ssm'


def asset_names(version):
    assert re.fullmatch(r'0\.0\.[0-9]+', version)
    return {'preview-release.json', 'SHA256SUMS', f'wharfie-aws-{version}.tgz',
            f'wharfie-wharfie-{version}.tgz', f'wharfie-v{version}-linux-x64',
            f'wharfie-v{version}-linux-x64.artifact.json'}


class AwsError(RuntimeError):
    def __init__(self, service, action, code, provider_code=None):
        super().__init__(service + '/' + action + ' failed (' + str(code) + ')')
        self.provider_code = provider_code


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1048576), b''):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def prepare(options):
    root = options.state.resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    preview = read_json(options.preview)
    spec = preview['providerSpec']
    assert preview['provider'] == 'aws' and spec['scope']['region'] == 'us-east-2'
    assert spec['scope']['partition'] == 'aws' and spec['scope']['accountId'] == ACCOUNT
    assert re.fullmatch(r'wharfie-soak-[a-z0-9-]{8,35}', options.campaign)
    assert spec['image']['ownerAccountId'] == '099720109477'
    assets = options.assets.resolve()
    assert re.fullmatch(r'[0-9a-f]{40}', options.commit)
    names = asset_names(options.version)
    assert {p.name for p in assets.iterdir()} == names
    assert all(p.is_file() and not p.is_symlink() for p in assets.iterdir())
    manifest = read_json(assets / 'preview-release.json')
    assert manifest['source'] == {'repository': 'https://github.com/wharfie/wharfie', 'commit': options.commit}
    assert manifest['tag'] == 'v' + options.version and manifest['version'] == options.version
    sums = dict(line.split('  ', 1)[::-1] for line in (assets / 'SHA256SUMS').read_text().splitlines())
    assert set(sums) == names - {'SHA256SUMS'}
    for name, digest in sums.items():
        assert sha256(assets / name) == digest
    for artifact in manifest['artifacts']:
        assert artifact['fileName'] in names
        assert sha256(assets / artifact['fileName']) == artifact['sha256']
        assert (assets / artifact['fileName']).stat().st_size == artifact['size']
    created = int(time.time())
    hours = soak_hours({'soakHours': options.soak_hours})
    config = {
        'format': 'wharfie.soak.campaign.v1', 'campaignId': options.campaign,
        'accountId': spec['scope']['accountId'], 'region': 'us-east-2',
        'imageId': spec['image']['id'], 'snapshotId': spec['image']['rootBlockDevice']['snapshotId'],
        'guestRootGiB': spec['image']['rootBlockDevice']['sizeGiB'],
        'vpcId': spec['network']['vpcId'], 'subnetId': spec['network']['subnet']['id'],
        'guestSubnetIds': [spec['network']['subnet']['id']],
        'controllerCommit': options.commit, 'sourceCommit': options.commit,
        'version': options.version, 'soakHours': hours,
        # The controller window is the full soak plus six hours for setup,
        # rehearsals, the final observation, and settlement.
        'createdAt': created, 'stopAt': created + (hours + 6) * 3600,
        'bucket': options.campaign + '-' + spec['scope']['accountId'],
        'tokenParameter': '/wharfie-soak/' + options.campaign + '/hetzner-token',
        'assets': {name: {'size': (assets / name).stat().st_size, 'sha256': sha256(assets / name)}
                   for name in sorted(names)},
        'operationsFiles': {name: sha256(HERE / name) for name in [
            *RUNTIME_FILES, 'wharfie-soak.service', 'policy.py', 'template.py', 'ops.py']},
    }
    config['specSha256'] = canonical_digest(config)
    # The same rule `apply` and `start` enforce, applied before anything is written.
    # With the current constants latest_start is 75 min after createdAt, so this
    # cannot fire; it guards future changes to the supervisor's constants.
    if latest_start(config) - created < PROVISION_BUDGET:
        raise RuntimeError('campaign-window-cannot-hold-setup-and-full-soak')
    atomic_json(root / 'campaign.json', config)
    template = render(config)
    atomic_json(root / 'cloudformation.json', template)
    atomic_json(root / 'ownership.json', {
        'campaignId': config['campaignId'], 'specSha256': config['specSha256'],
        'templateSha256': sha256(root / 'cloudformation.json'), 'stackId': None,
        'guestDeploymentIds': [], 'createdAt': created, 'status': 'prepared',
        'assetsDirectory': str(assets),
    })
    print(json.dumps({'status': 'prepared', 'state': str(root), 'stopAtUtc':
        datetime.fromtimestamp(config['stopAt'], timezone.utc).isoformat(), 'startByUtc':
        datetime.fromtimestamp(latest_start(config), timezone.utc).isoformat()}))


class Operator:
    def __init__(self, root):
        self.root = root.resolve()
        if self.root.is_symlink() or self.root.stat().st_mode & 0o077:
            raise RuntimeError('operator-state-must-be-private')
        self.config = read_json(self.root / 'campaign.json')
        expected = self.config['specSha256']
        raw = dict(self.config)
        raw.pop('specSha256')
        if canonical_digest(raw) != expected:
            raise RuntimeError('campaign-spec-changed')
        self.ownership = read_json(self.root / 'ownership.json')
        if self.ownership['specSha256'] != expected:
            raise RuntimeError('campaign-owner-changed')

    def save(self):
        atomic_json(self.root / 'ownership.json', self.ownership)

    def aws(self, service, action, value=None, timeout=120, extra=(), secret_stdin=None):
        # Secret values never appear in argv or CLI debug output. A secret is
        # passed as `secret_stdin` and named by the caller as file:///dev/stdin,
        # so it reaches the CLI through a pipe and is never written to disk.
        request_value = dict(value or {})
        named_arguments = []
        streaming_get = (service, action) == ('s3api', 'get-object')
        if streaming_get:
            # The streaming CLI customization has no --cli-input-json support.
            # Allow only the nonsecret fields used by bounded proof downloads.
            if set(request_value) != {'Bucket', 'Key', 'Range'}:
                raise ValueError('invalid-proof-object-fields')
            for name in ('Bucket', 'Key', 'Range'):
                selected = request_value.pop(name)
                if not isinstance(selected, str) or not selected:
                    raise ValueError('invalid-proof-object-identity')
                named_arguments.extend(['--' + name.lower(), selected])
        request_path = None
        input_arguments = []
        if not streaming_get:
            with tempfile.NamedTemporaryFile(dir=self.root, suffix='.aws-input.json', mode='w', delete=False) as request:
                request_path = Path(request.name)
                os.chmod(request_path, 0o600)
                json.dump(request_value, request)
            input_arguments = ['--cli-input-json', 'file://' + str(request_path)]
        command = ['aws', '--profile', 'wharfie', '--region', 'us-east-2',
                   '--no-cli-pager', '--output', 'json', '--cli-connect-timeout', '10',
                   '--cli-read-timeout', '60', service, action,
                   *input_arguments, *named_arguments, *extra]
        stdin = {'stdin': subprocess.DEVNULL} if secret_stdin is None else {'input': secret_stdin}
        try:
            response = subprocess.run(command, **stdin, capture_output=True,
                                      timeout=timeout, env={**os.environ, 'AWS_PAGER': ''})
            if response.returncode or len(response.stdout) > 1048576:
                match = re.search(rb'An error occurred \((NoSuchEntity|ResourceNotFoundException|ParameterNotFound)\)', response.stderr)
                code = match.group(1).decode() if match else None
                if code is None and re.search(rb'An error occurred \(ValidationError\) when calling the '
                                              rb'DescribeStacks operation: Stack with id \S+ does not exist', response.stderr):
                    code = 'StackNotFound'
                raise AwsError(service, action, response.returncode, code)
            return json.loads(response.stdout) if response.stdout.strip() else {}
        finally:
            if request_path is not None:
                request_path.unlink(missing_ok=True)

    def verify_operations_files(self):
        # Every command that acts on a prepared campaign runs the reviewed
        # operations code; a checkout change after preparation refuses here.
        for name, digest in self.config['operationsFiles'].items():
            if sha256(HERE / name) != digest:
                raise RuntimeError('reviewed-operations-files-changed')

    def verify_local_bundle(self):
        self.verify_operations_files()
        if sha256(self.root / 'cloudformation.json') != self.ownership['templateSha256']:
            raise RuntimeError('reviewed-template-changed')
        if time.time() > latest_start(self.config):
            raise RuntimeError('campaign-start-window-passed-prepare-new-campaign')

    def identity(self):
        account = self.aws('sts', 'get-caller-identity')['Account']
        if account != ACCOUNT or self.config['accountId'] != ACCOUNT:
            raise RuntimeError('wrong-aws-account')

    def stack(self):
        name = self.ownership['stackId'] or self.config['campaignId']
        response = self.aws('cloudformation', 'describe-stacks', {'StackName': name})
        if len(response['Stacks']) != 1:
            raise RuntimeError('ambiguous-campaign-stack')
        value = response['Stacks'][0]
        tags = {x['Key']: x['Value'] for x in value.get('Tags', [])}
        if tags.get('wharfie:soak-campaign') != self.config['campaignId'] or tags.get('wharfie:soak-spec') != self.config['specSha256']:
            raise RuntimeError('foreign-campaign-stack')
        if self.ownership['stackId'] and value['StackId'] != self.ownership['stackId']:
            raise RuntimeError('changed-stack-authority')
        return value

    def existing_stack(self):
        """The exact campaign stack, or None only when CloudFormation reports none."""
        try:
            return self.stack()
        except AwsError as error:
            if error.provider_code != 'StackNotFound':
                raise
            return None

    def wait_stack(self, acceptable, timeout=1200):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = self.stack()
            status = value['StackStatus']
            if status in acceptable:
                self.ownership['stackId'] = value['StackId']
                self.ownership['outputs'] = {x['OutputKey']: x['OutputValue'] for x in value.get('Outputs', [])}
                self.save()
                return value
            if status.endswith('_FAILED') or 'ROLLBACK' in status:
                raise RuntimeError('campaign-stack-failed-' + status)
            time.sleep(5)
        raise RuntimeError('campaign-stack-deadline')

    def apply(self):
        self.verify_local_bundle()
        # An apply that may still create a stack refuses when `start` could not
        # follow before latest_start; that stack would be billed but unusable.
        remaining = int(latest_start(self.config) - time.time())
        if not self.ownership.get('stackId') and remaining < APPLY_START_MARGIN:
            print(json.dumps({'status': 'apply-refused', 'secondsBeforeStartBy': remaining,
                              'requiredSeconds': APPLY_START_MARGIN}), file=sys.stderr)
            raise RuntimeError('campaign-start-too-close-for-apply-prepare-new-campaign')
        self.identity()
        image = self.aws('ec2', 'describe-images', {'ImageIds': [self.config['imageId']], 'Owners': ['099720109477']})
        if len(image['Images']) != 1 or image['Images'][0]['State'] != 'available':
            raise RuntimeError('pinned-image-unavailable')
        if not self.ownership.get('stackId'):
            # A previous attempt is reconciled before anything else. Only
            # CloudFormation's own report that no stack has the campaign name
            # permits another create; that name is unique among live stacks and
            # the request token is unchanged, so a retry cannot add a second stack.
            found = self.existing_stack() if self.ownership.get('createAttempted') else None
            if found is None:
                if self.ownership.get('status') != 'prepared':
                    raise RuntimeError('campaign-not-in-prepared-state')
                # The retained proof bucket has a fixed name. If it exists, an
                # earlier create got that far and its stack was deleted outside
                # this tool; creating again would fail on the bucket after
                # launching a billed controller. Only a 404 shows it absent; any
                # other head-bucket failure may be transient, so a rerun can recover.
                if self.ownership.get('createAttempted'):
                    bucket = self.bucket_state()
                    if bucket == 'present':
                        raise RuntimeError('campaign-bucket-exists-without-stack-prepare-new-campaign')
                    if bucket != 'absent':
                        raise RuntimeError('campaign-bucket-absence-unverified-rerun-apply')
                self.ownership['createAttempted'] = True
                self.save()
                template = (self.root / 'cloudformation.json').read_text()
                try:
                    found = self.aws('cloudformation', 'create-stack', {
                        'StackName': self.config['campaignId'], 'TemplateBody': template,
                        'Capabilities': ['CAPABILITY_NAMED_IAM'],
                        'ClientRequestToken': self.config['campaignId'] + '-create',
                        'OnFailure': 'DO_NOTHING',
                        'Tags': [{'Key': 'wharfie:soak-campaign', 'Value': self.config['campaignId']},
                                 {'Key': 'wharfie:soak-spec', 'Value': self.config['specSha256']}],
                    })
                except (AwsError, subprocess.TimeoutExpired):
                    # A matching existing stack is the only acceptable lost-response outcome.
                    found = self.existing_stack()
                    if found is None:
                        # Nothing was created; rerunning `apply` retries the create.
                        raise RuntimeError('campaign-stack-create-failed-rerun-apply') from None
            self.ownership['stackId'] = found['StackId']
            self.save()
        self.wait_stack({'CREATE_COMPLETE', 'UPDATE_COMPLETE'})
        instances = self.aws('ec2', 'describe-instances', {
            'InstanceIds': [self.ownership['outputs']['ControllerId']]})
        found = [x for reservation in instances['Reservations'] for x in reservation['Instances']]
        if len(found) != 1:
            raise RuntimeError('controller-instance-identity-ambiguous')
        self.ownership['controllerVolumeIds'] = [x['Ebs']['VolumeId'] for x in found[0]['BlockDeviceMappings']]
        self.ownership['status'] = 'provisioned'
        self.save()
        self.stage_inputs()
        print(json.dumps({'status': 'provisioned', 'controllerId': self.ownership['outputs']['ControllerId'],
                          'secondsBeforeStartBy': int(latest_start(self.config) - time.time())}))

    def stage_inputs(self):
        """Upload and read back the exact frozen inputs while bootstrap waits."""
        self.verify_local_bundle()
        self.identity()
        bundle = self.root / 'operations.json.xz'
        bundle.write_bytes(runtime_bundle(self.config))
        bundle.chmod(0o600)
        assets = Path(self.ownership['assetsDirectory'])
        entries = []
        for name, expected in self.config['assets'].items():
            source = assets / name
            if source.is_symlink() or not source.is_file() or source.stat().st_size != expected['size'] or sha256(source) != expected['sha256']:
                raise RuntimeError('frozen-candidate-input-changed')
            entries.append(('assets/' + name, source, expected['sha256'], expected['size']))
        # Publishing the bundle last releases bootstrap only after all assets exist.
        entries.append(('operations.json.xz', bundle, sha256(bundle), bundle.stat().st_size))
        for suffix, source, digest, size in entries:
            key = self.config['campaignId'] + '/inputs/' + suffix
            self.aws('s3api', 'put-object', {'Bucket': self.config['bucket'], 'Key': key,
                'ServerSideEncryption': 'AES256', 'Metadata': {'sha256': digest}},
                timeout=600, extra=('--body', str(source)))
            target = self.root / 'input-readback.tmp'
            try:
                self.aws('s3api', 'get-object', {'Bucket': self.config['bucket'], 'Key': key,
                    'Range': 'bytes=0-' + str(size)}, timeout=600, extra=(str(target),))
                if target.stat().st_size != size or sha256(target) != digest:
                    raise RuntimeError('frozen-input-readback-mismatch')
            finally:
                target.unlink(missing_ok=True)
        self.ownership['inputsUploaded'] = True
        self.save()

    def token(self):
        self.verify_operations_files()
        self.identity()
        # CLI history records request and response bodies, including the
        # secret, in ~/.aws/cli/history/history.db, and no option disables it
        # for one command.
        if self.cli_history_possible():
            raise RuntimeError('aws-cli-history-must-be-disabled-for-token')
        token = sys.stdin.read(4097).strip()
        if not 20 <= len(token) <= 4096 or '\n' in token:
            raise RuntimeError('token-input-invalid')
        current = self.stored_token() if self.ownership.get('tokenAttempted') else None
        if current is None:
            self.ownership['tokenAttempted'] = True
            self.save()
            try:
                # Overwrite is false: a retry can never replace a stored token.
                self.aws('ssm', 'put-parameter', {
                    'Name': self.config['tokenParameter'], 'Type': 'SecureString',
                    'Tier': 'Standard', 'Overwrite': False,
                    'Tags': [{'Key': 'wharfie:soak-campaign', 'Value': self.config['campaignId']},
                             {'Key': 'wharfie:soak-spec', 'Value': self.config['specSha256']}],
                }, extra=('--value', 'file:///dev/stdin'), secret_stdin=token.encode())
            except (AwsError, subprocess.TimeoutExpired):
                pass  # Only the independent read below can accept this attempt.
            current = self.stored_token()
            if current is None:
                # Nothing was stored; rerunning `token` retries the put.
                raise RuntimeError('campaign-token-not-stored-rerun-token')
        if current['Value'] != token or current['Type'] != 'SecureString':
            raise RuntimeError('existing-campaign-token-mismatch')
        # get-parameter does not report the KMS key; only the AWS-managed SSM
        # key, which the put above uses, is accepted.
        metadata = self.aws('ssm', 'describe-parameters', {'ParameterFilters': [
            {'Key': 'Name', 'Option': 'Equals', 'Values': [self.config['tokenParameter']]}]})['Parameters']
        if len(metadata) != 1 or metadata[0].get('KeyId') != DEFAULT_SSM_KEY:
            raise RuntimeError('existing-campaign-token-key-mismatch')
        self.ownership['tokenStored'] = True
        self.save()
        print('{"status":"secure-string-stored"}')

    def cli_history_possible(self):
        """True unless the effective profile leaves cli_history unset or disabled."""
        result = subprocess.run(['aws', '--profile', 'wharfie', 'configure', 'get', 'cli_history'],
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=60)
        if result.returncode == 1 and not result.stdout.strip() and not result.stderr.strip():
            return False
        return result.returncode != 0 or result.stdout.strip() != b'disabled'

    def stored_token(self):
        """The campaign parameter, or None only when SSM reports it absent."""
        try:
            return self.aws('ssm', 'get-parameter', {
                'Name': self.config['tokenParameter'], 'WithDecryption': True})['Parameter']
        except AwsError as error:
            if error.provider_code != 'ParameterNotFound':
                raise
            return None

    def remote_json(self, suffix, optional=False):
        target = self.root / 'download.tmp.json'
        # An optional object can appear between the failed get and its
        # confirming head (a gate request is written while `authorize` polls).
        # S3 reads are strongly consistent, so that object is read again; an
        # object that stays present but unreadable still fails closed.
        for _ in range(3):
            target.unlink(missing_ok=True)
            try:
                result = self.aws('s3api', 'get-object', {'Bucket': self.config['bucket'],
                    'Key': self.config['campaignId'] + '/' + suffix,
                    'Range': 'bytes=0-' + str(MAX_JSON)}, extra=(str(target),))
                if result.get('ContentLength', 0) > MAX_JSON or target.stat().st_size > MAX_JSON:
                    raise RuntimeError('remote-proof-limit')
                return read_json(target)
            except AwsError:
                if not optional:
                    raise
                # Optional does not conflate IAM/network failures with absence:
                # head-object must independently return a 404, inspected privately.
                state = self.object_state(suffix)
                if state == 'absent':
                    return None
                if state != 'present':
                    raise
            finally:
                target.unlink(missing_ok=True)
        raise AwsError('s3api', 'get-object', 'present-but-unreadable')

    def object_state(self, suffix):
        command = ['aws', '--profile', 'wharfie', '--region', 'us-east-2', '--no-cli-pager',
                   's3api', 'head-object', '--bucket', self.config['bucket'], '--key',
                   self.config['campaignId'] + '/' + suffix]
        result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=30)
        if result.returncode == 0:
            return 'present'
        if b'(404)' in result.stderr and b'HeadObject' in result.stderr:
            return 'absent'
        return None

    def verify_deadman(self):
        outputs = self.ownership['outputs']
        schedule = self.aws('scheduler', 'get-schedule', {
            'Name': self.config['campaignId'] + '-stop', 'GroupName': self.config['campaignId']})
        expected = datetime.fromtimestamp(self.config['stopAt'], timezone.utc).strftime('%Y-%m-%dT%H:%M:%S')
        hours = soak_hours(self.config)
        if self.config['stopAt'] != self.config['createdAt'] + (hours + 6) * 3600:
            raise RuntimeError('external-stop-deadline-invalid')
        # Starting later guarantees the full soak is refused after both rehearsals.
        if time.time() > latest_start(self.config):
            raise RuntimeError('campaign-start-window-passed-prepare-new-campaign')
        if schedule['State'] != 'ENABLED' or schedule['ScheduleExpression'] != 'at(' + expected + ')':
            raise RuntimeError('external-stop-authority-mismatch')
        if json.loads(schedule['Target']['Input']) != {'InstanceIds': [outputs['ControllerId']], 'Force': True}:
            raise RuntimeError('external-stop-target-mismatch')
        role = f"arn:aws:iam::{self.config['accountId']}:role/{self.config['campaignId']}-deadman"
        if schedule['Target']['RoleArn'] != role or schedule['Target']['Arn'] != 'arn:aws:scheduler:::aws-sdk:ec2:stopInstances':
            raise RuntimeError('external-stop-role-mismatch')
        addresses = self.aws('ec2', 'describe-addresses', {'AllocationIds': [outputs['AllocationId']]})['Addresses']
        if len(addresses) != 1 or addresses[0]['InstanceId'] != outputs['ControllerId'] or addresses[0]['PublicIp'] != outputs['ControllerIpv4']:
            raise RuntimeError('fixed-egress-authority-mismatch')

    def start(self):
        self.verify_operations_files()
        self.identity()
        self.wait_stack({'CREATE_COMPLETE', 'UPDATE_COMPLETE'})
        self.verify_deadman()
        if not self.ownership.get('tokenStored'):
            raise RuntimeError('private-token-not-stored')
        instance = self.ownership['outputs']['ControllerId']
        commands = ['test -f /var/lib/wharfie-soak/bootstrap-ready.json',
                    'timeout 10 systemctl daemon-reload',
                    'active_state=$(timeout 5 systemctl show wharfie-soak.service --property=ActiveState --value)',
                    'case "$active_state" in failed) timeout 5 systemctl reset-failed wharfie-soak.service ;; active|inactive) ;; *) exit 1 ;; esac',
                    'timeout 15 systemctl enable --now wharfie-soak.service']
        request = self.aws('ssm', 'send-command', {
            'InstanceIds': [instance], 'DocumentName': 'AWS-RunShellScript',
            'Parameters': {'commands': ['set -eu', *commands], 'executionTimeout': ['60']},
            'TimeoutSeconds': 120,
        })
        self.ownership['startCommandId'] = request['Command']['CommandId']
        self.ownership['status'] = 'started'
        self.save()
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            try:
                observed = self.aws('ssm', 'get-command-invocation', {
                    'CommandId': request['Command']['CommandId'], 'InstanceId': instance})
            except AwsError:
                time.sleep(2)
                continue
            if observed['Status'] == 'Success':
                break
            if observed['Status'] in ('Failed', 'Cancelled', 'TimedOut', 'Cancelling'):
                raise RuntimeError('controller-start-command-failed')
            time.sleep(2)
        else:
            raise RuntimeError('controller-start-observation-deadline')
        print(json.dumps({'status': 'start-requested', 'commandId': request['Command']['CommandId']}))

    def validate_gate(self, gate, label, require_fresh=True):
        config = self.config
        assert label in ('rehearsal-aws', 'soak-aws')
        assert gate['format'] == 'wharfie.soak.apply-gate.v1'
        assert gate['campaignId'] == config['campaignId']
        assert gate['controllerCommit'] == config['controllerCommit'] and gate['sourceCommit'] == config['sourceCommit']
        assert re.fullmatch(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}', gate['runId'])
        assert re.fullmatch(r'wsnd1_[A-Za-z0-9_-]{43}', gate['deploymentInstanceId'])
        assert gate['runDir'] == '/var/lib/wharfie-soak/runs/' + label
        if require_fresh:
            assert -5 <= time.time() - gate['requestedAt'] / 1000 < 1800
        run, preview = gate['run'], gate['preview']
        # Original raw-file hashes are retained; parsed authority is checked independently.
        assert re.fullmatch(r'[0-9a-f]{64}', gate['runSha256'])
        assert re.fullmatch(r'[0-9a-f]{64}', gate['previewSha256'])
        assert run['runId'] == gate['runId'] and run['deploymentInstanceId'] == gate['deploymentInstanceId']
        assert run['provider'] == 'aws' and run['placement'] == 'us-east-2'
        assert run['deploymentId'] == 'acceptance-' + gate['runId']
        assert run['appId'] == 'steady-file-demo' and run['applyAttempted'] is True
        assert run['soak']['startedAt'] is None
        assert run['soak']['durationMs'] == (900000 if label == 'rehearsal-aws'
                                             else soak_hours(config) * 3600000)
        assert preview['provider'] == 'aws' and preview['status'] == 'actionable'
        assert preview['journal']['state'] == 'absent'
        assert preview['deployment']['deploymentInstanceId'] == gate['deploymentInstanceId']
        assert preview['deployment']['deploymentId'] == run['deploymentId']
        assert preview['deployment']['access']['allowedIpv4'] == [self.ownership['outputs']['ControllerIpv4'] + '/32']
        assert run['allowedIpv4'] == self.ownership['outputs']['ControllerIpv4'] + '/32'
        spec = preview['providerSpec']
        assert spec['scope'] == {'accountId': config['accountId'], 'partition': 'aws', 'region': 'us-east-2'}
        assert spec['machineType'] == 't3.small'
        assert spec['image']['id'] == config['imageId']
        assert spec['image']['ownerAccountId'] == '099720109477'
        assert spec['image']['rootBlockDevice']['snapshotId'] == config['snapshotId']
        assert spec['image']['rootBlockDevice']['encrypted'] is True
        assert spec['image']['rootBlockDevice']['volumeType'] == 'gp3'
        assert spec['image']['rootBlockDevice']['sizeGiB'] == config['guestRootGiB']
        assert spec['network']['subnet']['id'] in config['guestSubnetIds']
        assert spec['network']['vpcId'] == config['vpcId']

    def approve(self, gate, label):
        existing = self.remote_json('gates/' + label + '/approved.json', optional=True)
        self.validate_gate(gate, label, require_fresh=existing is None)
        current = self.stack()
        parameters = {x['ParameterKey']: x['ParameterValue'] for x in current['Parameters']}
        ids = [x for x in parameters['GuestDeploymentIds'].split(',') if x != 'UNAUTHORIZED']
        selected = gate['deploymentInstanceId']
        if existing is not None:
            for key in ('campaignId', 'runId', 'runSha256', 'previewSha256', 'deploymentInstanceId'):
                if existing.get(key) != gate[key]:
                    raise RuntimeError('retained-gate-approval-mismatch')
            if selected not in ids or selected not in existing.get('policyDeploymentIds', []):
                raise RuntimeError('retained-gate-no-longer-authorized')
            if existing.get('controllerRole') != self.ownership['outputs']['RoleName']:
                raise RuntimeError('retained-gate-role-mismatch')
            return
        if selected not in ids:
            if len(ids) >= 2:
                raise RuntimeError('campaign-deployment-count-exceeded')
            ids.append(selected)
            self.ownership['pendingGuestDeploymentIds'] = ids
            self.save()
            self.aws('cloudformation', 'update-stack', {
                'StackName': self.ownership['stackId'], 'UsePreviousTemplate': True,
                'Capabilities': ['CAPABILITY_NAMED_IAM'],
                'Parameters': [{'ParameterKey': 'GuestDeploymentIds', 'ParameterValue': ','.join(ids)}],
                'ClientRequestToken': self.config['campaignId'] + '-gate-' + gate['runId'],
            })
        self.wait_stack({'UPDATE_COMPLETE'}, timeout=600)
        self.ownership['guestDeploymentIds'] = ids
        self.save()
        approval = {key: gate[key] for key in (
            'campaignId', 'runId', 'runSha256', 'previewSha256', 'deploymentInstanceId')}
        approval.update(approvedAt=time.time(), policyDeploymentIds=ids,
                        controllerRole=self.ownership['outputs']['RoleName'])
        path = self.root / (label + '-approval.json')
        atomic_json(path, approval)
        self.aws('s3api', 'put-object', {'Bucket': self.config['bucket'],
            'Key': self.config['campaignId'] + '/gates/' + label + '/approved.json',
            'ServerSideEncryption': 'AES256'}, extra=('--body', str(path)))
        print(json.dumps({'status': 'exact-deployment-authorized', 'label': label, 'runId': gate['runId']}), flush=True)

    def authorize(self):
        self.verify_operations_files()
        self.identity()
        # Both rehearsals and long AWS setup must fit in the fixed setup window.
        deadline = time.monotonic() + SETUP_BUDGET
        done = set()
        failures = 0
        last_healthy = time.monotonic()
        while time.monotonic() < deadline:
            healthy = True
            for label in ('rehearsal-aws', 'soak-aws'):
                if label in done:
                    continue
                gate, ok = self.poll_json('gates/' + label + '/request.json', deadline)
                healthy = healthy and ok
                if gate is not None:
                    self.approve(gate, label)
                    done.add(label)
            if len(done) == 2:
                return
            state, ok = self.poll_json('supervisor.json', deadline)
            healthy = healthy and ok
            if state is not None and state.get('status') == 'failed':
                raise RuntimeError('campaign-failed-during-setup')
            failures = 0 if healthy else failures + 1
            if healthy:
                last_healthy = time.monotonic()
            if failures >= MAX_POLL_FAILURES or time.monotonic() - last_healthy >= MAX_POLL_FAILURE_SECONDS:
                raise RuntimeError('local-gate-watch-read-failures')
            time.sleep(5)
        raise RuntimeError('local-gate-watch-deadline')

    def poll_json(self, suffix, deadline):
        """One watch read. A failed read is only retried later, never treated as
        absence or approval; approval itself still fails closed in `approve`."""
        if time.monotonic() >= deadline:
            raise RuntimeError('local-gate-watch-deadline')
        try:
            return self.remote_json(suffix, optional=True), True
        except (AwsError, subprocess.TimeoutExpired) as error:
            print(json.dumps({'status': 'watch-read-failed', 'object': suffix, 'error': type(error).__name__,
                              'at': datetime.now(timezone.utc).isoformat()}), file=sys.stderr, flush=True)
            return None, False

    def collect(self):
        self.verify_operations_files()
        self.identity()
        target_root = self.root / 'collected'
        target_root.mkdir(mode=0o700, exist_ok=True)
        summary = self.remote_json('supervisor.json')
        if summary['campaignId'] != self.config['campaignId'] or summary['specSha256'] != self.config['specSha256']:
            raise RuntimeError('exported-campaign-mismatch')
        if summary.get('status') not in ('passed', 'failed'):
            raise RuntimeError('campaign-not-terminal')
        collected = []
        optional_diagnostics_unavailable = []
        for label in summary['runs']:
            if label not in ('rehearsal-aws', 'rehearsal-hetzner', 'soak-aws', 'soak-hetzner'):
                raise RuntimeError('foreign-export-label')
            export = self.remote_json('runs/' + label + '/export.json')
            assert export['label'] == label and export['campaignId'] == self.config['campaignId']
            if len(export['files']) > 20:
                raise RuntimeError('export-file-count-limit')
            for entry in export['files']:
                prefix = self.config['campaignId'] + '/runs/' + label + '/'
                assert entry['key'].startswith(prefix)
                name = entry['key'][len(prefix):]
                assert re.fullmatch(r'[a-z0-9-]+\.(json|tar\.gz)', name)
                limit = 536870912 if name == 'recovery.tar.gz' else 16777216 if name == 'diagnostics.tar.gz' else MAX_JSON
                assert 0 < entry['size'] <= limit
                directory = target_root / label
                directory.mkdir(mode=0o700, exist_ok=True)
                destination = directory / name
                try:
                    self.aws('s3api', 'get-object', {'Bucket': self.config['bucket'], 'Key': entry['key'],
                        'Range': 'bytes=0-' + str(entry['size'])},
                             timeout=600, extra=(str(destination),))
                    if destination.stat().st_size != entry['size'] or sha256(destination) != entry['sha256']:
                        raise RuntimeError('downloaded-export-mismatch')
                    destination.chmod(0o600)
                except Exception:
                    if name not in ('observer.json', 'diagnostics.tar.gz'):
                        raise
                    destination.unlink(missing_ok=True)
                    optional_diagnostics_unavailable.append(label + '/' + name)
                    continue
                collected.append({'label': label, 'name': name, 'sha256': entry['sha256'], 'size': entry['size']})
            atomic_json(target_root / label / 'export.json', export)
        atomic_json(target_root / 'supervisor.json', summary)
        diagnostics_sha256 = None
        diagnostics_path = target_root / 'supervisor-diagnostics.json'
        try:
            diagnostics = self.remote_json('supervisor-diagnostics.json', optional=True)
            if diagnostics is None or diagnostics['campaignId'] != self.config['campaignId']:
                raise RuntimeError('controller-diagnostics-unavailable')
            atomic_json(diagnostics_path, diagnostics)
            diagnostics_sha256 = sha256(diagnostics_path)
        except Exception:
            diagnostics_path.unlink(missing_ok=True)
            optional_diagnostics_unavailable.append('supervisor-diagnostics.json')
        atomic_json(self.root / 'collection.json', {'campaignId': self.config['campaignId'],
            'specSha256': self.config['specSha256'], 'collectedAt': time.time(), 'files': collected,
            'summarySha256': sha256(target_root / 'supervisor.json'),
            'diagnosticsSha256': diagnostics_sha256,
            'optionalDiagnosticsUnavailable': optional_diagnostics_unavailable})
        print(json.dumps({'status': 'collected', 'campaignStatus': summary['status'], 'files': len(collected)}))

    def teardown(self):
        self.verify_operations_files()
        self.identity()
        collection = read_json(self.root / 'collection.json')
        summary_path = self.root / 'collected' / 'supervisor.json'
        assert sha256(summary_path) == collection['summarySha256']
        assert collection['campaignId'] == self.config['campaignId']
        summary = read_json(summary_path)
        # Failed proofs can still clean up successfully. Never destroy a machine
        # with any unverified guest cleanup, even if a recovery archive exists.
        # A run that never attempted apply has no guest to recover; accept it
        # only from its own collected, hash-listed runner evidence.
        listed = {(entry['label'], entry['name']) for entry in collection['files']}
        for label, outcome in summary['runs'].items():
            if not outcome.get('proofExported'):
                raise RuntimeError('recover-guest-authority-before-controller-deletion')
            directory = self.root / 'collected' / label
            cleanup_name = 'cleanup-report.json' if (directory / 'cleanup-report.json').exists() else 'report.json'
            cleanup = read_json(directory / cleanup_name)
            if outcome.get('cleanupVerifiedAbsent') is True:
                if not (cleanup.get('workspaceRemoved') and (cleanup.get('cleanup') or {}).get('status') == 'absent'):
                    raise RuntimeError('independent-guest-audit-not-absent')
            elif outcome.get('neverCreated') is True:
                names = ('run.json', 'report.json', 'retirement.json', cleanup_name)
                if not all((label, name) in listed for name in names):
                    raise RuntimeError('never-created-evidence-not-collected')
                run, report, retirement = (read_json(directory / name) for name in names[:3])
                provider = label.split('-')[-1]
                if (outcome.get('status') != 'failed' or outcome.get('provider') != provider
                        or not never_created_evidence(provider, run, report, retirement, cleanup)):
                    raise RuntimeError('independent-guest-audit-not-never-created')
            else:
                raise RuntimeError('recover-guest-authority-before-controller-deletion')
        for entry in collection['files']:
            path = self.root / 'collected' / entry['label'] / entry['name']
            assert path.stat().st_size == entry['size'] and sha256(path) == entry['sha256']
        self.delete_controller()

    def abort_setup(self):
        self.verify_operations_files()
        self.identity()
        stack = self.stack()
        parameters = {x['ParameterKey']: x['ParameterValue'] for x in stack['Parameters']}
        if parameters.get('GuestDeploymentIds') != 'UNAUTHORIZED':
            raise RuntimeError('guest-writes-authorized-use-run-cleanup-and-collection')
        # The default role genuinely has no EC2 writes. The pinned supervisor
        # cannot start Hetzner until its AWS rehearsal passes, which requires
        # that external gate. No credentials or journals may be discarded after
        # that gate has been authorized; this path refuses it.
        actual = self.aws('cloudformation', 'get-template', {'StackName': stack['StackId']})['TemplateBody']
        if isinstance(actual, str):
            actual = json.loads(actual)
        if actual != read_json(self.root / 'cloudformation.json'):
            raise RuntimeError('unlaunched-stack-template-changed')
        self.ownership['stackId'] = stack['StackId']
        self.ownership['abortBeforeGuestAuthorization'] = True
        self.save()
        self.delete_controller(allow_setup_failure=True)

    def delete_controller(self, allow_setup_failure=False):
        stack = self.stack()
        eligible = {'CREATE_COMPLETE', 'UPDATE_COMPLETE', 'DELETE_FAILED',
                    'DELETE_IN_PROGRESS', 'DELETE_COMPLETE'}
        if allow_setup_failure:
            eligible.add('CREATE_FAILED')
        if stack['StackStatus'] not in eligible:
            raise RuntimeError('controller-stack-not-ready-for-deletion')
        if 'outputs' not in self.ownership or not self.ownership.get('controllerVolumeIds'):
            resources = self.aws('cloudformation', 'describe-stack-resources', {
                'StackName': self.ownership['stackId']})['StackResources']
            physical = {x['LogicalResourceId']: x.get('PhysicalResourceId') for x in resources}
            outputs = self.ownership.setdefault('outputs', {})
            if physical.get('Controller'):
                outputs['ControllerId'] = physical['Controller']
                instances = self.aws('ec2', 'describe-instances', {'Filters': [
                    {'Name': 'instance-id', 'Values': [physical['Controller']]}]})
                found = [x for r in instances['Reservations'] for x in r['Instances']]
                if len(found) > 1:
                    raise RuntimeError('ambiguous-controller-resource')
                self.ownership['controllerVolumeIds'] = [
                    x['Ebs']['VolumeId'] for instance in found for x in instance['BlockDeviceMappings']]
            self.ownership['bucketCreated'] = bool(physical.get('ProofBucket'))
            self.save()
        self.ownership['status'] = 'deletion-requested'
        self.save()
        if stack['StackStatus'] not in ('DELETE_IN_PROGRESS', 'DELETE_COMPLETE'):
            try:
                self.aws('cloudformation', 'delete-stack', {'StackName': self.ownership['stackId'],
                    'ClientRequestToken': self.config['campaignId'] + '-delete'})
            except (AwsError, subprocess.TimeoutExpired):
                if self.stack()['StackStatus'] not in ('DELETE_IN_PROGRESS', 'DELETE_COMPLETE'):
                    raise
        deadline = time.monotonic() + 1200
        while time.monotonic() < deadline:
            try:
                stack = self.stack()
                if stack['StackStatus'] == 'DELETE_COMPLETE':
                    break
                if stack['StackStatus'] == 'DELETE_FAILED':
                    raise RuntimeError('controller-stack-delete-failed')
            except AwsError:
                # Known stack ARN remains queryable after deletion; absence alone
                # is not independent authority to claim all resources removed.
                raise RuntimeError('controller-delete-observation-failed')
            time.sleep(5)
        else:
            raise RuntimeError('controller-delete-deadline')
        outputs = self.ownership['outputs']
        if outputs.get('ControllerId'):
            instances = self.aws('ec2', 'describe-instances', {'Filters': [
                {'Name': 'instance-id', 'Values': [outputs['ControllerId']]}]})
            observed = [x for r in instances['Reservations'] for x in r['Instances']]
            assert len(observed) <= 1 and all(x['State']['Name'] == 'terminated' for x in observed)
        residue = self.aws('ec2', 'describe-addresses', {'Filters': [
            {'Name': 'tag:wharfie:soak-campaign', 'Values': [self.config['campaignId']]}]})
        assert not residue['Addresses']
        groups = self.aws('ec2', 'describe-security-groups', {'Filters': [
            {'Name': 'tag:wharfie:soak-campaign', 'Values': [self.config['campaignId']]}]})
        assert not groups['SecurityGroups']
        if self.ownership.get('controllerVolumeIds'):
            volumes = self.aws('ec2', 'describe-volumes', {'Filters': [
                {'Name': 'volume-id', 'Values': self.ownership['controllerVolumeIds']}]})
            assert not volumes['Volumes']
        # The token and proof bucket are deliberately not stack deletion targets.
        token_before = self.aws('ssm', 'get-parameters', {'Names': [self.config['tokenParameter']]})
        if token_before['Parameters']:
            tags = self.aws('ssm', 'list-tags-for-resource', {
                'ResourceType': 'Parameter', 'ResourceId': self.config['tokenParameter']})['TagList']
            selected = {x['Key']: x['Value'] for x in tags}
            if selected.get('wharfie:soak-campaign') != self.config['campaignId'] or selected.get('wharfie:soak-spec') != self.config['specSha256']:
                raise RuntimeError('foreign-token-parameter')
            try:
                self.aws('ssm', 'delete-parameter', {'Name': self.config['tokenParameter']})
            except (AwsError, subprocess.TimeoutExpired):
                pass  # Only the independent absent check below can accept this.
        token_check = self.aws('ssm', 'get-parameters', {'Names': [self.config['tokenParameter']]})
        assert not token_check['Parameters'] and token_check['InvalidParameters'] == [self.config['tokenParameter']]
        checks = [
            ('iam', 'get-role', {'RoleName': self.config['campaignId'] + '-controller'}, 'NoSuchEntity'),
            ('iam', 'get-instance-profile', {'InstanceProfileName': self.config['campaignId'] + '-controller'}, 'NoSuchEntity'),
            ('iam', 'get-role', {'RoleName': self.config['campaignId'] + '-deadman'}, 'NoSuchEntity'),
            ('scheduler', 'get-schedule', {'Name': self.config['campaignId'] + '-stop', 'GroupName': self.config['campaignId']}, 'ResourceNotFoundException'),
            ('scheduler', 'get-schedule-group', {'Name': self.config['campaignId']}, 'ResourceNotFoundException'),
        ]
        for service, action, request, absent_code in checks:
            try:
                self.aws(service, action, request)
            except AwsError as error:
                if error.provider_code != absent_code:
                    raise RuntimeError('controller-authority-absence-unverified') from None
            else:
                raise RuntimeError('controller-authority-still-present')
        if self.ownership.get('bucketCreated') is not False:
            bucket = self.config['bucket']
            tags = self.aws('s3api', 'get-bucket-tagging', {'Bucket': bucket})['TagSet']
            selected = {entry['Key']: entry['Value'] for entry in tags}
            assert selected.get('wharfie:soak-campaign') == self.config['campaignId']
            assert selected.get('wharfie:soak-spec') == self.config['specSha256']
            policy = {'Version': '2012-10-17', 'Statement': [{
                'Sid': 'TLSOnly', 'Effect': 'Deny', 'Principal': '*', 'Action': 's3:*',
                'Resource': ['arn:aws:s3:::' + bucket, 'arn:aws:s3:::' + bucket + '/*'],
                'Condition': {'Bool': {'aws:SecureTransport': 'false'}}}]}
            self.aws('s3api', 'put-bucket-policy', {'Bucket': bucket, 'Policy': json.dumps(policy)})
            actual = self.aws('s3api', 'get-bucket-policy', {'Bucket': bucket})
            assert json.loads(actual['Policy']) == policy
        self.ownership['status'] = 'controller-cleaned-proofs-retained'
        self.ownership['cleanedAt'] = time.time()
        self.ownership['iamAndSchedulerAbsenceVerified'] = True
        self.save()
        print(json.dumps({'status': self.ownership['status'], 'retainedBucket': self.config['bucket']}))

    def purge_proofs(self):
        self.verify_operations_files()
        self.identity()
        if self.ownership['status'] == 'all-campaign-resources-cleaned':
            print('{"status":"all-campaign-resources-cleaned"}')
            return
        if self.ownership['status'] != 'controller-cleaned-proofs-retained':
            raise RuntimeError('controller-cleanup-required-before-proof-purge')
        if not self.ownership.get('abortBeforeGuestAuthorization'):
            collection = read_json(self.root / 'collection.json')
            for entry in collection['files']:
                path = self.root / 'collected' / entry['label'] / entry['name']
                assert path.stat().st_size == entry['size'] and sha256(path) == entry['sha256']
            assert sha256(self.root / 'collected' / 'supervisor.json') == collection['summarySha256']
        bucket = self.config['bucket']
        if self.ownership.get('proofPurgeAttempted') or self.ownership.get('bucketCreated') is False:
            if self.bucket_absent():
                self.ownership['status'] = 'all-campaign-resources-cleaned'
                self.save()
                print('{"status":"all-campaign-resources-cleaned"}')
                return
        tags = self.aws('s3api', 'get-bucket-tagging', {'Bucket': bucket})['TagSet']
        selected = {x['Key']: x['Value'] for x in tags}
        if selected.get('wharfie:soak-campaign') != self.config['campaignId'] or selected.get('wharfie:soak-spec') != self.config['specSha256']:
            raise RuntimeError('foreign-proof-bucket')
        objects = self.aws('s3api', 'list-objects-v2', {'Bucket': bucket, 'MaxKeys': 1000})
        if objects.get('IsTruncated') or len(objects.get('Contents', [])) > 100:
            raise RuntimeError('unexpected-proof-bucket-size')
        keys = [x['Key'] for x in objects.get('Contents', [])]
        prefix = self.config['campaignId'] + '/'
        patterns = [r'supervisor(?:-diagnostics)?\.json', r'gates/(rehearsal|soak)-aws/(request|approved)\.json',
                    r'runs/(rehearsal|soak)-(aws|hetzner)/[a-z0-9-]+\.(json|tar\.gz)']
        input_keys = {'inputs/operations.json.xz', *['inputs/assets/' + name for name in self.config['assets']]}
        if any(not key.startswith(prefix) or (key[len(prefix):] not in input_keys and not any(re.fullmatch(p, key[len(prefix):]) for p in patterns)) for key in keys):
            raise RuntimeError('foreign-proof-keys')
        if keys:
            removed = self.aws('s3api', 'delete-objects', {'Bucket': bucket,
                'Delete': {'Objects': [{'Key': key} for key in keys], 'Quiet': True}})
            if removed.get('Errors'):
                raise RuntimeError('proof-object-delete-failed')
        remaining = self.aws('s3api', 'list-objects-v2', {'Bucket': bucket, 'MaxKeys': 1})
        if remaining.get('Contents'):
            raise RuntimeError('proof-bucket-not-empty')
        self.ownership['proofPurgeAttempted'] = True
        self.save()
        self.aws('s3api', 'delete-bucket', {'Bucket': bucket})
        if not self.bucket_absent():
            raise RuntimeError('proof-bucket-absence-unverified')
        self.ownership['status'] = 'all-campaign-resources-cleaned'
        self.save()
        print('{"status":"all-campaign-resources-cleaned"}')

    def bucket_state(self):
        result = subprocess.run(['aws', '--profile', 'wharfie', '--region', 'us-east-2', '--no-cli-pager',
                                 's3api', 'head-bucket', '--bucket', self.config['bucket']],
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=30)
        if result.returncode == 0:
            return 'present'
        if b'(404)' in result.stderr and b'HeadBucket' in result.stderr:
            return 'absent'
        return None

    def bucket_absent(self):
        return self.bucket_state() == 'absent'


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['prepare', 'apply', 'stage-inputs', 'token', 'start', 'authorize', 'status',
                        'collect', 'teardown', 'abort-setup', 'purge-proofs'])
    parser.add_argument('--state', type=Path, required=True)
    parser.add_argument('--preview', type=Path)
    parser.add_argument('--assets', type=Path)
    parser.add_argument('--campaign')
    parser.add_argument('--commit')
    parser.add_argument('--version')
    parser.add_argument('--soak-hours', type=int, choices=[48, 72])
    options = parser.parse_args()
    if options.command == 'prepare':
        if not (options.preview and options.assets and options.campaign and options.commit
                and options.version and options.soak_hours):
            parser.error('prepare requires --preview, --assets, --campaign, --commit, --version and --soak-hours')
        prepare(options)
        return
    lock = open(options.state / 'operator.lock', 'a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    operator = Operator(options.state)
    if options.command == 'status':
        value = operator.remote_json('supervisor.json', optional=True)
        print(json.dumps(value if value else {'status': 'no-exported-progress'}))
    else:
        getattr(operator, options.command.replace('-', '_'))()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not print SDK/CLI payloads, token-bearing input, or arbitrary exceptions.
        print('Campaign operation failed: ' + type(error).__name__, file=sys.stderr)
        raise SystemExit(1)
