import contextlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import ops


class OperatorCliTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='wharfie cli test ')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.operator = ops.Operator.__new__(ops.Operator)
        self.operator.root = self.root
        # The operator always names profile `wharfie`. Give the real CLI parser
        # that profile from a private config with no credentials, instead of
        # the developer's (or runner's) real AWS configuration.
        aws_temporary = tempfile.TemporaryDirectory(prefix='wharfie-cli-aws-config-')
        self.addCleanup(aws_temporary.cleanup)
        aws_config = Path(aws_temporary.name) / 'config'
        aws_config.write_text('[profile wharfie]\nregion = us-east-2\n')
        aws_credentials = Path(aws_temporary.name) / 'credentials'
        aws_credentials.write_text('')
        environment = mock.patch.dict(os.environ, {
            'AWS_CONFIG_FILE': str(aws_config),
            'AWS_SHARED_CREDENTIALS_FILE': str(aws_credentials)})
        environment.start()
        self.addCleanup(environment.stop)
        for name in ('AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
                     'AWS_SESSION_TOKEN'):
            os.environ.pop(name, None)

    @unittest.skipUnless(shutil.which('aws'), 'AWS CLI parser is not installed')
    def test_streaming_get_passes_real_cli_parser_without_any_remote_endpoint(self):
        # A refused loopback endpoint proves parsing completed. No AWS endpoint,
        # signing, credentials, or cloud operation is involved in this test.
        real_run = subprocess.run
        observed = []

        def execute(command, **kwargs):
            command = command + ['--endpoint-url', 'http://127.0.0.1:1', '--no-sign-request']
            kwargs['env'].update(AWS_MAX_ATTEMPTS='1', AWS_EC2_METADATA_DISABLED='true',
                                 NO_PROXY='127.0.0.1', no_proxy='127.0.0.1')
            result = real_run(command, **kwargs)
            observed.append((command, result))
            return result

        value = {'Bucket': 'example', 'Key': 'literal key/receipt.json', 'Range': 'bytes=0-262144'}
        with mock.patch.object(ops.subprocess, 'run', side_effect=execute):
            with self.assertRaises(ops.AwsError):
                self.operator.aws('s3api', 'get-object', value, timeout=10,
                                  extra=(str(self.root / 'output with spaces.json'),))
        command, result = observed[0]
        self.assertNotIn('--cli-input-json', command)
        self.assertEqual(command[command.index('--key') + 1], value['Key'])
        self.assertIn(b'Could not connect to the endpoint URL', result.stderr)
        self.assertEqual(list(self.root.iterdir()), [])
        # The same installed CLI rejects the original JSON-input invocation
        # during parsing, before any request to even the loopback endpoint.
        request = self.root / 'original.json'
        request.write_text(json.dumps(value))
        original = real_run(['aws', '--no-cli-pager', 's3api', 'get-object',
                             '--cli-input-json', 'file://' + str(request),
                             str(self.root / 'original-output.json')],
                            capture_output=True, timeout=10)
        self.assertNotEqual(original.returncode, 0)
        self.assertIn(b'--bucket, --key', original.stderr)
        self.assertFalse((self.root / 'original-output.json').exists())

    def test_unknown_streaming_fields_never_enter_argv_or_a_subprocess(self):
        with mock.patch.object(ops.subprocess, 'run') as run:
            with self.assertRaises(ValueError):
                self.operator.aws('s3api', 'get-object', {
                    'Bucket': 'example', 'Key': 'receipt', 'Range': 'bytes=0-262144',
                    'SSECustomerKey': 'must-stay-private'})
            run.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    @unittest.skipUnless(shutil.which('aws'), 'AWS CLI parser is not installed')
    def test_put_object_keeps_json_input_and_body_with_real_offline_cli(self):
        real_run = subprocess.run
        body = self.root / 'approval body.json'
        body.write_text('{}')

        def execute(command, **kwargs):
            self.assertIn('--cli-input-json', command)
            self.assertNotIn('--bucket', command)
            # Skeleton output exercises parsing/validation without an API call.
            return real_run(command + ['--generate-cli-skeleton', 'output'], **kwargs)

        with mock.patch.object(ops.subprocess, 'run', side_effect=execute):
            result = self.operator.aws('s3api', 'put-object', {
                'Bucket': 'example', 'Key': 'gates/approval.json',
                'ServerSideEncryption': 'AES256'}, timeout=10,
                extra=('--body', str(body)))
        self.assertIn('ETag', result)
        self.assertEqual(list(self.root.iterdir()), [body])

    def test_other_requests_keep_private_json_and_remove_it_on_failure(self):
        secret = 'test-only-value-that-must-not-enter-argv'

        def execute(command, **kwargs):
            self.assertFalse(any(secret in argument for argument in command))
            request = Path(command[command.index('--cli-input-json') + 1][7:])
            self.assertEqual(stat.S_IMODE(request.stat().st_mode), 0o600)
            self.assertEqual(json.loads(request.read_text())['Value'], secret)
            return subprocess.CompletedProcess(command, 1, b'', b'deliberate failure')

        with mock.patch.object(ops.subprocess, 'run', side_effect=execute):
            with self.assertRaises(ops.AwsError):
                self.operator.aws('ssm', 'put-parameter', {'Value': secret})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_inactive_start_does_not_reset_unloaded_unit(self):
        self.assert_start('inactive', ['daemon-reload', 'show', 'enable'])

    def test_failed_start_resets_only_the_failed_unit(self):
        self.assert_start('failed', ['daemon-reload', 'show', 'reset-failed', 'enable'])

    def test_unexpected_state_stops_before_enable(self):
        self.assert_start('activating', ['daemon-reload', 'show'], success=False)

    def assert_start(self, state, expected, success=True):
        self.operator.config = {}
        self.operator.ownership = {'tokenStored': True, 'outputs': {'ControllerId': 'i-test'}}
        self.operator.verify_operations_files = lambda: None
        self.operator.identity = lambda: None
        self.operator.wait_stack = lambda _: None
        self.operator.verify_deadman = lambda: None
        self.operator.save = lambda: None
        requests = []

        def aws(service, action, value):
            if action == 'send-command':
                requests.append(value)
                return {'Command': {'CommandId': 'test-command'}}
            return {'Status': 'Success'}

        self.operator.aws = aws
        with contextlib.redirect_stdout(io.StringIO()):
            self.operator.start()
        commands = requests[0]['Parameters']['commands']
        self.assertEqual(requests[0]['InstanceIds'], ['i-test'])
        commands[1] = 'test -f "$BOOTSTRAP_READY"'
        (self.root / 'ready').touch()
        # Only external systemctl and timeout are injected. The actual emitted
        # POSIX shell control flow executes, including set -eu and state capture.
        (self.root / 'timeout').write_text('#!/bin/sh\nshift\nexec "$@"\n')
        (self.root / 'systemctl').write_text('''#!/bin/sh
printf '%s\\n' "$1" >> "$CALL_LOG"
case "$1" in
  show) printf '%s\\n' "$ACTIVE_STATE" ;;
  reset-failed) [ "$ACTIVE_STATE" = failed ] ;;
esac
''')
        for name in ('timeout', 'systemctl'):
            (self.root / name).chmod(0o755)
        environment = {'PATH': str(self.root) + ':/usr/bin:/bin',
                       'BOOTSTRAP_READY': str(self.root / 'ready'),
                       'CALL_LOG': str(self.root / 'calls'), 'ACTIVE_STATE': state}
        result = subprocess.run(['/bin/sh', '-s'], input='\n'.join(commands),
                                text=True, capture_output=True, env=environment, timeout=10)
        self.assertEqual(result.returncode == 0, success, result.stderr)
        self.assertEqual((self.root / 'calls').read_text().splitlines(), expected)


if __name__ == '__main__':
    unittest.main()
