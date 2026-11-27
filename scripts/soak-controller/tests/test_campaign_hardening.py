"""Regressions from launching the 0.0.17 campaign: no AWS endpoint or credentials."""
import contextlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ops
import supervisor as operator_supervisor  # the module instance ops.py imports
from test_controller import config, fake_gate
from test_supervisor import supervisor, MemoryEvidenceClient, TOKEN


def operator(root):
    value = object.__new__(ops.Operator)
    value.root = Path(root)
    value.config = config()
    value.ownership = {'status': 'prepared', 'stackId': None,
                       'outputs': {'ControllerIpv4': config()['controllerIpv4']}}
    value.save = mock.Mock()
    value.verify_operations_files = mock.Mock()
    value.verify_local_bundle = mock.Mock()
    value.identity = mock.Mock()
    return value


class AuthorizeWatchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.operator = operator(temporary.name)
        self.operator.approve = mock.Mock()
        # A fake monotonic clock bounds every watch loop by its own deadline, so a
        # regression that never stops fails in milliseconds instead of hanging.
        self.clock = [1000.0]
        for name, fake in (('sleep', lambda seconds: self.advance(seconds)),
                           ('monotonic', lambda: self.clock[0])):
            patch = mock.patch.object(ops.time, name, side_effect=fake)
            patch.start()
            self.addCleanup(patch.stop)

    def advance(self, seconds):
        self.clock[0] += seconds

    def authorize(self):
        errors = io.StringIO()
        with contextlib.redirect_stderr(errors):
            self.operator.authorize()
        return errors.getvalue()

    def test_timed_out_watch_read_is_retried_and_logged(self):
        # Observed 2026-11-19T22:19:12Z: one polling get-object exceeded its
        # 120 s limit while no gate was pending, and `authorize` exited.
        gate = fake_gate(config())
        reads = []

        def remote_json(suffix, optional=False):
            self.assertTrue(optional)
            reads.append(suffix)
            if len(reads) == 1:
                raise subprocess.TimeoutExpired(['aws'], 120)
            return gate if suffix.endswith('request.json') else None

        self.operator.remote_json = remote_json
        log = self.authorize()
        self.assertEqual([call.args[1] for call in self.operator.approve.call_args_list],
                         ['soak-aws', 'rehearsal-aws'])
        event = json.loads(log.splitlines()[0])
        self.assertEqual(event['status'], 'watch-read-failed')
        self.assertEqual(event['object'], 'gates/rehearsal-aws/request.json')
        self.assertEqual(event['error'], 'TimeoutExpired')

    def test_persistent_watch_read_failure_stops_after_bounded_cycles(self):
        self.operator.remote_json = mock.Mock(side_effect=ops.AwsError('s3api', 'get-object', 255))
        with self.assertRaisesRegex(RuntimeError, 'local-gate-watch-read-failures'):
            self.authorize()
        self.operator.approve.assert_not_called()
        # Three reads per cycle: both gate requests and the supervisor summary.
        self.assertEqual(self.operator.remote_json.call_count, 3 * ops.MAX_POLL_FAILURES)

    def test_one_successful_cycle_resets_the_failure_budget(self):
        failing = [True] * (ops.MAX_POLL_FAILURES - 1) + [False] + [True] * (ops.MAX_POLL_FAILURES - 1)
        cycles = iter(failing + [None])

        def remote_json(suffix, optional=False):
            if suffix == 'supervisor.json':
                state = next(cycles)
                if state is None:
                    return {'status': 'failed'}
                if state:
                    raise subprocess.TimeoutExpired(['aws'], 120)
            return None

        self.operator.remote_json = remote_json
        with self.assertRaisesRegex(RuntimeError, 'campaign-failed-during-setup'):
            self.authorize()

    def test_supervisor_summary_read_failures_count_toward_the_cap(self):
        def remote_json(suffix, optional=False):
            if suffix == 'supervisor.json':
                raise subprocess.TimeoutExpired(['aws'], 120)
            return None
        self.operator.remote_json = mock.Mock(side_effect=remote_json)
        with self.assertRaisesRegex(RuntimeError, 'local-gate-watch-read-failures'):
            self.authorize()
        summaries = [call for call in self.operator.remote_json.call_args_list
                     if call.args[0] == 'supervisor.json']
        self.assertEqual(len(summaries), ops.MAX_POLL_FAILURES)

    def test_no_successful_cycle_for_the_failure_period_stops_before_the_cycle_cap(self):
        def slow_failure(suffix, optional=False):
            self.advance(200)
            raise ops.AwsError('s3api', 'get-object', 255)
        self.operator.remote_json = mock.Mock(side_effect=slow_failure)
        with self.assertRaisesRegex(RuntimeError, 'local-gate-watch-read-failures'):
            self.authorize()
        # Two cycles of three 200 s reads pass 900 s; the cycle cap alone needs ten.
        self.assertEqual(self.operator.remote_json.call_count, 6)

    def test_a_successful_cycle_restarts_the_failure_period(self):
        # 100 s reads: two failing cycles, one healthy, two failing, then a
        # healthy cycle that reports the campaign failed. No failing stretch
        # reaches 900 s, though failing time in total does.
        schedule = iter([True, True, False, True, True, None])
        def remote_json(suffix, optional=False):
            self.advance(100)
            if suffix != 'supervisor.json':
                return None
            failing = next(schedule)
            if failing is None:
                return {'status': 'failed'}
            if failing:
                raise ops.AwsError('s3api', 'get-object', 255)
            return None
        self.operator.remote_json = remote_json
        with self.assertRaisesRegex(RuntimeError, 'campaign-failed-during-setup'):
            self.authorize()

    def test_overall_deadline_is_checked_before_each_read(self):
        def slow_absence(suffix, optional=False):
            self.advance(4000)
            return None
        self.operator.remote_json = mock.Mock(side_effect=slow_absence)
        with self.assertRaisesRegex(RuntimeError, 'local-gate-watch-deadline'):
            self.authorize()
        # The third read would start 8000 s after the 7200 s window opened.
        self.assertEqual([call.args[0] for call in self.operator.remote_json.call_args_list],
                         ['gates/rehearsal-aws/request.json', 'gates/soak-aws/request.json'])
        self.assertEqual(ops.SETUP_BUDGET, 7200)

    def test_approval_aws_error_is_never_retried(self):
        self.operator.remote_json = mock.Mock(return_value=fake_gate(config()))
        self.operator.approve.side_effect = ops.AwsError('cloudformation', 'update-stack', 254)
        with self.assertRaises(ops.AwsError):
            self.authorize()
        self.assertEqual(self.operator.approve.call_count, 1)

    def test_approval_failures_and_invalid_evidence_are_never_retried(self):
        for error in (AssertionError(), RuntimeError('remote-proof-limit'), ValueError()):
            with self.subTest(error=type(error).__name__):
                self.operator.remote_json = mock.Mock(side_effect=error)
                with self.assertRaises(type(error)):
                    self.authorize()
                self.assertEqual(self.operator.remote_json.call_count, 1)
        self.operator.remote_json = mock.Mock(return_value=fake_gate(config()))
        self.operator.approve.side_effect = AssertionError('changed gate authority')
        with self.assertRaises(AssertionError):
            self.authorize()
        self.assertEqual(self.operator.approve.call_count, 1)


class OptionalReadRaceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.operator = operator(temporary.name)
        self.gets = 0

    def get_object(self, appears_after):
        def aws(service, action, value, **kwargs):
            self.assertEqual((service, action), ('s3api', 'get-object'))
            self.gets += 1
            if self.gets <= appears_after:
                raise ops.AwsError(service, action, 254)
            Path(kwargs['extra'][0]).write_text('{"format":"gate"}')
            return {'ContentLength': 17}
        return aws

    def head(self, returncode, stderr=b''):
        return mock.patch.object(ops.subprocess, 'run', return_value=subprocess.CompletedProcess(
            ['aws'], returncode, b'', stderr))

    def test_object_that_appears_between_get_and_head_is_read_again(self):
        # Observed 2026-11-19T22:57:09Z in the second the soak-aws gate request appeared.
        self.operator.aws = self.get_object(appears_after=1)
        with self.head(0) as head:
            value = self.operator.remote_json('gates/soak-aws/request.json', optional=True)
        self.assertEqual(value, {'format': 'gate'})
        self.assertEqual(self.gets, 2)
        self.assertEqual(head.call_count, 1)
        self.assertEqual(list(self.operator.root.iterdir()), [])

    def test_present_but_unreadable_object_still_fails_closed(self):
        self.operator.aws = self.get_object(appears_after=99)
        with self.head(0) as head, self.assertRaises(ops.AwsError):
            self.operator.remote_json('gates/soak-aws/request.json', optional=True)
        self.assertEqual(self.gets, 3)
        self.assertEqual(head.call_count, 3)

    def test_only_an_independent_404_is_absence(self):
        self.operator.aws = self.get_object(appears_after=99)
        with self.head(254, b'An error occurred (404) when calling the HeadObject operation: Not Found'):
            self.assertIsNone(self.operator.remote_json('supervisor.json', optional=True))
        for stderr in (b'An error occurred (403) when calling the HeadObject operation: Forbidden',
                       b'An error occurred (AccessDenied) when calling the HeadObject operation: Access Denied',
                       b'Could not connect to the endpoint URL'):
            with self.subTest(stderr=stderr), self.head(254, stderr):
                self.assertIsNone(self.operator.object_state('supervisor.json'))
                self.gets = 0
                with self.assertRaises(ops.AwsError):
                    self.operator.remote_json('supervisor.json', optional=True)
                # Unknown is neither absence nor presence: no second get.
                self.assertEqual(self.gets, 1)
        self.gets = 0
        with self.head(0) as head, self.assertRaises(ops.AwsError):
            self.operator.remote_json('supervisor.json')
        head.assert_not_called()
        self.assertEqual(self.gets, 1)


class RecoverableAttemptTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.operator = operator(temporary.name)
        (self.operator.root / 'cloudformation.json').write_text('{}')
        self.operator.bucket_state = mock.Mock(return_value='absent')
        self.operator.cli_history_possible = mock.Mock(return_value=False)
        self.calls = []

    def stack_value(self):
        c = config()
        return {'StackId': 'arn:aws:cloudformation:exact', 'StackStatus': 'CREATE_COMPLETE',
                'Tags': [{'Key': 'wharfie:soak-campaign', 'Value': c['campaignId']},
                         {'Key': 'wharfie:soak-spec', 'Value': c['specSha256']}]}

    def apply(self, create, describe):
        def aws(service, action, value=None, **kwargs):
            self.calls.append((action, value))
            if action == 'describe-images':
                return {'Images': [{'State': 'available'}]}
            if action == 'create-stack':
                return create(value)
            if action == 'describe-stacks':
                return describe(value)
            if action == 'describe-instances':
                return {'Reservations': [{'Instances': [{'BlockDeviceMappings': [
                    {'Ebs': {'VolumeId': 'vol-exact'}}]}]}]}
            self.fail('unexpected call: ' + action)

        def wait_stack(_acceptable):
            self.operator.ownership['outputs'] = {'ControllerId': 'i-exact'}

        self.operator.aws = aws
        self.operator.wait_stack = wait_stack
        self.operator.stage_inputs = mock.Mock()
        self.output = io.StringIO()
        with contextlib.redirect_stdout(self.output):
            self.operator.apply()

    def missing_stack(self, _value):
        raise ops.AwsError('cloudformation', 'describe-stacks', 254, 'StackNotFound')

    def test_genuine_create_failure_is_recoverable_by_rerunning_apply(self):
        def rejected(_value):
            raise ops.AwsError('cloudformation', 'create-stack', 254)
        with self.assertRaisesRegex(RuntimeError, 'campaign-stack-create-failed-rerun-apply'):
            self.apply(rejected, self.missing_stack)
        self.assertTrue(self.operator.ownership['createAttempted'])
        self.assertIsNone(self.operator.ownership['stackId'])
        self.calls.clear()
        self.apply(lambda _value: {'StackId': 'arn:aws:cloudformation:exact'}, self.missing_stack)
        actions = [action for action, _ in self.calls]
        # Reconciliation runs before the only retried create.
        self.assertLess(actions.index('describe-stacks'), actions.index('create-stack'))
        self.assertEqual(actions.count('create-stack'), 1)
        request = next(value for action, value in self.calls if action == 'create-stack')
        self.assertEqual(request['ClientRequestToken'], config()['campaignId'] + '-create')
        self.assertEqual(self.operator.ownership['stackId'], 'arn:aws:cloudformation:exact')
        self.assertEqual(self.operator.ownership['status'], 'provisioned')

    def test_lost_create_response_reconciles_and_never_creates_again(self):
        def lost(_value):
            raise subprocess.TimeoutExpired(['aws'], 120)
        self.apply(lost, lambda _value: {'Stacks': [self.stack_value()]})
        self.assertEqual(self.operator.ownership['stackId'], 'arn:aws:cloudformation:exact')
        self.calls.clear()
        self.operator.ownership.update(stackId=None, status='prepared')
        self.apply(lambda _value: self.fail('must not create again'),
                   lambda _value: {'Stacks': [self.stack_value()]})
        self.assertNotIn('create-stack', [action for action, _ in self.calls])

    def test_unknown_or_foreign_stack_state_never_permits_another_create(self):
        self.operator.ownership['createAttempted'] = True
        def unknown(_value):
            raise ops.AwsError('cloudformation', 'describe-stacks', 255)
        foreign = self.stack_value()
        foreign['Tags'][1]['Value'] = 'b' * 64
        for describe, error in ((unknown, ops.AwsError),
                                (lambda _value: {'Stacks': [foreign]}, RuntimeError)):
            with self.subTest(error=error.__name__), self.assertRaises(error):
                self.apply(lambda _value: self.fail('must not create'), describe)
        self.operator.ownership['status'] = 'deletion-requested'
        with self.assertRaisesRegex(RuntimeError, 'campaign-not-in-prepared-state'):
            self.apply(lambda _value: self.fail('must not create'), self.missing_stack)

    def test_rerun_refuses_create_when_the_retained_bucket_proves_an_earlier_stack(self):
        self.operator.ownership['createAttempted'] = True
        self.operator.bucket_state.return_value = 'present'
        with self.assertRaisesRegex(RuntimeError, 'campaign-bucket-exists-without-stack-prepare-new-campaign'):
            self.apply(lambda _value: self.fail('must not create'), self.missing_stack)
        self.operator.bucket_state.assert_called_once()
        self.assertIsNone(self.operator.ownership['stackId'])

    def test_first_apply_refuses_inside_the_start_margin_before_any_aws_call(self):
        boundary = ops.latest_start(self.operator.config) - ops.APPLY_START_MARGIN
        errors = io.StringIO()
        with mock.patch.object(ops.time, 'time', return_value=boundary + 1), \
             contextlib.redirect_stderr(errors), \
             self.assertRaisesRegex(RuntimeError, 'campaign-start-too-close-for-apply-prepare-new-campaign'):
            self.apply(lambda _value: self.fail('must not create'), self.missing_stack)
        self.assertEqual(self.calls, [])
        self.operator.identity.assert_not_called()
        self.operator.bucket_state.assert_not_called()
        self.operator.save.assert_not_called()
        self.assertIsNone(self.operator.ownership['stackId'])
        self.assertEqual(json.loads(errors.getvalue())['secondsBeforeStartBy'],
                         ops.APPLY_START_MARGIN - 1)

    def test_rerun_inside_the_start_margin_refuses_another_create_only_after_reconciling(self):
        self.operator.ownership['createAttempted'] = True
        boundary = ops.latest_start(self.operator.config) - ops.APPLY_START_MARGIN
        errors = io.StringIO()
        with mock.patch.object(ops.time, 'time', return_value=boundary + 1), \
             contextlib.redirect_stderr(errors), \
             self.assertRaisesRegex(RuntimeError, 'campaign-start-too-close-for-apply-prepare-new-campaign'):
            self.apply(lambda _value: self.fail('must not create'), self.missing_stack)
        self.assertEqual([action for action, _ in self.calls], ['describe-images', 'describe-stacks'])
        self.operator.bucket_state.assert_not_called()
        self.operator.save.assert_not_called()
        self.assertIsNone(self.operator.ownership['stackId'])
        self.assertEqual(json.loads(errors.getvalue())['secondsBeforeStartBy'],
                         ops.APPLY_START_MARGIN - 1)

    def test_rerun_inside_the_start_margin_still_records_a_live_unrecorded_stack(self):
        # create-stack succeeded but its response was lost before stackId was saved.
        self.operator.ownership['createAttempted'] = True
        boundary = ops.latest_start(self.operator.config) - ops.APPLY_START_MARGIN
        with mock.patch.object(ops.time, 'time', return_value=boundary + 1):
            self.apply(lambda _value: self.fail('must not create'),
                       lambda _value: {'Stacks': [self.stack_value()]})
        self.assertNotIn('create-stack', [action for action, _ in self.calls])
        self.assertEqual(self.operator.ownership['stackId'], 'arn:aws:cloudformation:exact')
        self.assertEqual(self.operator.ownership['status'], 'provisioned')

    def test_apply_is_accepted_at_the_start_margin_and_reports_the_time_left(self):
        boundary = ops.latest_start(self.operator.config) - ops.APPLY_START_MARGIN
        with mock.patch.object(ops.time, 'time', return_value=boundary):
            self.apply(lambda _value: {'StackId': 'arn:aws:cloudformation:exact'}, self.missing_stack)
        self.assertEqual(self.operator.ownership['status'], 'provisioned')
        self.assertEqual([action for action, _ in self.calls].count('create-stack'), 1)
        self.assertEqual(json.loads(self.output.getvalue())['secondsBeforeStartBy'], ops.APPLY_START_MARGIN)

    def test_apply_for_a_recorded_stack_is_not_held_to_the_start_margin(self):
        self.operator.ownership.update(stackId='arn:aws:cloudformation:exact', createAttempted=True)
        boundary = ops.latest_start(self.operator.config) - ops.APPLY_START_MARGIN
        with mock.patch.object(ops.time, 'time', return_value=boundary + 1):
            self.apply(lambda _value: self.fail('must not create'), self.missing_stack)
        self.assertEqual(self.operator.ownership['status'], 'provisioned')

    def test_cli_absence_codes_are_parsed_privately(self):
        for stderr, code in (
            (b'\nAn error occurred (ValidationError) when calling the CreateStack operation: '
             b'Stack with id wharfie-soak-test-01234567 does not exist\n', None),
            (b'\nAn error occurred (ValidationError) when calling the DescribeStacks operation: '
             b'Stack with id wharfie-soak-test-01234567 does not exist\n', 'StackNotFound'),
            (b'\nAn error occurred (ParameterNotFound) when calling the GetParameter operation: \n',
             'ParameterNotFound'),
            (b'\nAn error occurred (ValidationError) when calling the CreateStack operation: '
             b'Template format error\n', None),
        ):
            with self.subTest(code=code), mock.patch.object(ops.subprocess, 'run', return_value=
                    subprocess.CompletedProcess(['aws'], 254, b'', stderr)):
                with self.assertRaises(ops.AwsError) as raised:
                    self.operator.aws('cloudformation', 'describe-stacks', {'StackName': 'x'})
                self.assertEqual(raised.exception.provider_code, code)

    def token(self, put, stored, key_id=ops.DEFAULT_SSM_KEY, matches=1):
        def aws(service, action, value=None, **kwargs):
            if action == 'describe-parameters':
                self.assertEqual(value['ParameterFilters'], [{'Key': 'Name', 'Option': 'Equals',
                                                              'Values': [config()['tokenParameter']]}])
                metadata = {'Name': config()['tokenParameter']}
                if key_id is not None:
                    metadata['KeyId'] = key_id
                return {'Parameters': [dict(metadata) for _ in range(matches)]}
            self.calls.append((action, value, kwargs))
            if action == 'put-parameter':
                return put(value)
            if action == 'get-parameter':
                return stored()
            self.fail('unexpected call: ' + action)
        self.operator.aws = aws
        with mock.patch.object(ops.sys, 'stdin', io.StringIO(TOKEN + '\n')), \
             contextlib.redirect_stdout(io.StringIO()):
            self.operator.token()

    def parameter_missing(self):
        raise ops.AwsError('ssm', 'get-parameter', 254, 'ParameterNotFound')

    def parameter(self, value=TOKEN, kind='SecureString'):
        return lambda: {'Parameter': {'Value': value, 'Type': kind}}

    def test_failed_token_put_is_recoverable_and_never_overwrites(self):
        def rejected(_value):
            raise ops.AwsError('ssm', 'put-parameter', 254)
        with self.assertRaisesRegex(RuntimeError, 'campaign-token-not-stored-rerun-token'):
            self.token(rejected, self.parameter_missing)
        self.assertTrue(self.operator.ownership['tokenAttempted'])
        self.assertNotIn('tokenStored', self.operator.ownership)
        self.calls.clear()
        stored = []
        self.token(lambda value: stored.append(value) or {},
                   lambda: (self.parameter() if stored else self.parameter_missing)())
        self.assertEqual([action for action, _, _ in self.calls],
                         ['get-parameter', 'put-parameter', 'get-parameter'])
        self.assertIs(stored[0]['Overwrite'], False)
        self.assertTrue(self.operator.ownership['tokenStored'])

    def test_lost_put_response_or_existing_parameter_is_accepted_only_when_identical(self):
        def lost(_value):
            raise subprocess.TimeoutExpired(['aws'], 120)
        self.token(lost, self.parameter())
        self.assertTrue(self.operator.ownership['tokenStored'])
        for stored in (self.parameter('a-different-token-value-xyz'), self.parameter(kind='String')):
            self.operator.ownership = {'tokenAttempted': True}
            self.calls.clear()
            with self.assertRaisesRegex(RuntimeError, 'existing-campaign-token-mismatch'):
                self.token(lambda _value: self.fail('must not put again'), stored)
            self.assertNotIn('tokenStored', self.operator.ownership)

    def test_unreadable_parameter_is_never_treated_as_absent(self):
        self.operator.ownership['tokenAttempted'] = True
        def denied():
            raise ops.AwsError('ssm', 'get-parameter', 254)
        with self.assertRaises(ops.AwsError):
            self.token(lambda _value: self.fail('must not put'), denied)
        self.assertEqual([action for action, _, _ in self.calls], ['get-parameter'])
        self.assertNotIn('tokenStored', self.operator.ownership)

    def test_existing_parameter_under_another_kms_key_is_refused(self):
        for key_id in ('alias/foreign', 'arn:aws:kms:us-east-2:123456789012:key/0000', None):
            with self.subTest(key_id=key_id):
                self.operator.ownership = {'tokenAttempted': True}
                with self.assertRaisesRegex(RuntimeError, 'existing-campaign-token-key-mismatch'):
                    self.token(lambda _value: self.fail('must not put'), self.parameter(), key_id=key_id)
                self.assertNotIn('tokenStored', self.operator.ownership)

    def test_existing_parameter_needs_exactly_one_metadata_match(self):
        # Even when every returned entry names the default key.
        for matches in (0, 2):
            with self.subTest(matches=matches):
                self.operator.ownership = {'tokenAttempted': True}
                with self.assertRaisesRegex(RuntimeError, 'existing-campaign-token-key-mismatch'):
                    self.token(lambda _value: self.fail('must not put'), self.parameter(), matches=matches)
                self.assertNotIn('tokenStored', self.operator.ownership)

    def test_token_refuses_before_reading_the_secret_when_cli_history_may_record_it(self):
        self.operator.cli_history_possible.return_value = True
        self.operator.aws = mock.Mock(side_effect=AssertionError('no AWS call may carry the secret'))
        stdin = io.StringIO(TOKEN)
        with mock.patch.object(ops.sys, 'stdin', stdin), \
             self.assertRaisesRegex(RuntimeError, 'aws-cli-history-must-be-disabled-for-token'):
            self.operator.token()
        self.assertEqual(stdin.tell(), 0)
        self.operator.aws.assert_not_called()

    def test_token_reaches_the_cli_only_through_stdin(self):
        self.token(lambda _value: {}, lambda: (self.parameter() if len(self.calls) > 1 else self.parameter_missing)())
        _, request, options = next(call for call in self.calls if call[0] == 'put-parameter')
        self.assertNotIn('Value', request)
        self.assertNotIn(TOKEN, json.dumps(request))
        self.assertEqual(options['extra'], ('--value', 'file:///dev/stdin'))
        self.assertEqual(options['secret_stdin'], TOKEN.encode())


HEAD_BUCKET = {
    'present': (0, b''),
    'not-found': (254, b'\nAn error occurred (404) when calling the HeadBucket operation: Not Found\n'),
    'forbidden': (254, b'\nAn error occurred (403) when calling the HeadBucket operation: Forbidden\n'),
    'network': (255, b'\nCould not connect to the endpoint URL: "https://s3.us-east-2.amazonaws.com/"\n'),
}


class CliProbeOutcomeTests(unittest.TestCase):
    """Only an explicit 404 is absence and only unset/disabled is history-off."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.operator = operator(temporary.name)
        self.heads = []

    def head_bucket(self, outcome):
        returncode, stderr = HEAD_BUCKET[outcome]
        def run(command, **_kwargs):
            self.assertEqual(command[command.index('s3api') + 1], 'head-bucket')
            self.heads.append(outcome)
            return subprocess.CompletedProcess(command, returncode, b'', stderr)
        return mock.patch.object(ops.subprocess, 'run', side_effect=run)

    def test_apply_rerun_creates_again_only_after_a_head_bucket_404(self):
        expected = {'not-found': None,
                    'present': 'campaign-bucket-exists-without-stack-prepare-new-campaign',
                    'forbidden': 'campaign-bucket-absence-unverified-rerun-apply',
                    'network': 'campaign-bucket-absence-unverified-rerun-apply'}
        for outcome, error in expected.items():
            with self.subTest(outcome):
                attempt = RecoverableAttemptTests('test_cli_absence_codes_are_parsed_privately')
                attempt.setUp()
                self.addCleanup(attempt.doCleanups)
                del attempt.operator.bucket_state  # the real head-bucket interpretation
                attempt.operator.ownership['createAttempted'] = True
                creates = []
                create = lambda value: creates.append(value) or {'StackId': 'arn:aws:cloudformation:exact'}
                with self.head_bucket(outcome):
                    if error is None:
                        attempt.apply(create, attempt.missing_stack)
                    else:
                        with self.assertRaisesRegex(RuntimeError, error):
                            attempt.apply(create, attempt.missing_stack)
                self.assertEqual(len(creates), 1 if error is None else 0)

    def purge(self, outcome, **ownership):
        self.operator.ownership.update(status='controller-cleaned-proofs-retained',
                                       abortBeforeGuestAuthorization=True, **ownership)
        c = config()
        def aws(service, action, value=None, **_kwargs):
            responses = {'get-bucket-tagging': {'TagSet': [
                             {'Key': 'wharfie:soak-campaign', 'Value': c['campaignId']},
                             {'Key': 'wharfie:soak-spec', 'Value': c['specSha256']}]},
                         'list-objects-v2': {'IsTruncated': False}, 'delete-bucket': {}}
            return responses[action]
        self.operator.aws = mock.Mock(side_effect=aws)
        with self.head_bucket(outcome), contextlib.redirect_stdout(io.StringIO()):
            self.operator.purge_proofs()

    def test_purge_accepts_absence_only_from_a_head_bucket_404(self):
        for outcome in HEAD_BUCKET:
            for retry in ({'bucketCreated': False}, {'proofPurgeAttempted': True}, {}):
                with self.subTest(outcome=outcome, ownership=retry):
                    self.setUp()
                    if outcome == 'not-found':
                        self.purge(outcome, **retry)
                        self.assertEqual(self.operator.ownership['status'], 'all-campaign-resources-cleaned')
                    else:
                        with self.assertRaisesRegex(RuntimeError, 'proof-bucket-absence-unverified'):
                            self.purge(outcome, **retry)
                        self.assertNotEqual(self.operator.ownership['status'], 'all-campaign-resources-cleaned')
                    # A retry's pre-check 404 finishes without touching the bucket.
                    # Any other pre-check result falls through to the full,
                    # tag-checked purge, whose delete is verified by head-bucket again.
                    actions = [call.args[1] for call in self.operator.aws.call_args_list]
                    if retry and outcome == 'not-found':
                        self.assertEqual((len(self.heads), actions), (1, []))
                    else:
                        self.assertEqual(len(self.heads), 2 if retry else 1)
                        self.assertEqual(actions, ['get-bucket-tagging', 'list-objects-v2',
                                                   'list-objects-v2', 'delete-bucket'])

    def test_cli_history_is_off_only_when_unset_or_disabled(self):
        cases = (
            ((1, b'', b''), False),  # unset
            ((0, b'disabled\n', b''), False),
            ((0, b'enabled\n', b''), True),
            ((1, b'', b'\nThe config profile (wharfie) could not be found\n'), True),
            ((255, b'', b'\naws: error: unexpected failure\n'), True),
            ((255, b'', b''), True),
            ((1, b'enabled\n', b''), True),
        )
        for (returncode, stdout, stderr), possible in cases:
            with self.subTest(returncode=returncode, stdout=stdout, stderr=stderr), \
                 mock.patch.object(ops.subprocess, 'run', return_value=subprocess.CompletedProcess(
                     ['aws'], returncode, stdout, stderr)) as run:
                self.assertIs(self.operator.cli_history_possible(), possible)
                self.assertEqual(run.call_args.args[0],
                                 ['aws', '--profile', 'wharfie', 'configure', 'get', 'cli_history'])


class SupervisorScheduleTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='wharfie-hardening-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / 'controller'
        self.root.mkdir(mode=0o700)
        patch = mock.patch.object(supervisor, 'ROOT', self.root)
        patch.start()
        self.addCleanup(patch.stop)
        supervisor.STOP.clear()
        supervisor.STOP_REASON = None
        self.addCleanup(supervisor.STOP.clear)
        self.config = {'campaignId': 'fixture-campaign', 'specSha256': 'a' * 64,
                       'sourceCommit': 'b' * 40, 'stopAt': time.time() + 80 * 3600, 'soakHours': 72,
                       'controllerIpv4': '192.0.2.15', 'bucket': 'fixture-bucket-never-contacted'}
        self.client = MemoryEvidenceClient()
        process = mock.patch.object(supervisor.subprocess, 'Popen',
                                    side_effect=AssertionError('unexpected subprocess'))
        process.start()
        self.addCleanup(process.stop)
        self.campaign = supervisor.Campaign(self.config, supervisor.Evidence(self.config, self.client), TOKEN)
        # Settlement has its own tests; these assert only the scheduling decision.
        self.campaign.settle = lambda _label, outcome: outcome

    def running_soak(self, label='soak-aws', end_at=None):
        run_dir = supervisor.safe_relative_run(label)
        run_dir.mkdir(parents=True)
        now = int(time.time() * 1000)
        end_at = end_at if end_at is not None else now + 3600000
        for name, value in (('report.json', {'status': 'running'}),
                            ('soak-progress.json', {'complete': False, 'completedRuns': 1}),
                            ('soak.json', {'startedAt': now, 'endAt': end_at, 'intervalMs': 900000,
                                           'completed': [{}], 'pending': None, 'complete': False})):
            supervisor.atomic_json(run_dir / name, value)
        return run_dir

    def finish_soak(self, run_dir):
        def invoke(_label, _arguments, cleanup=False):
            self.assertFalse(cleanup)
            supervisor.atomic_json(run_dir / 'report.json', {'status': 'passed'})
            supervisor.atomic_json(run_dir / 'soak-progress.json', {'complete': True, 'completedRuns': 288})
            return 0
        return invoke

    def test_late_soak_is_refused_before_launch_with_a_recorded_reason(self):
        # Inside the previous five-minute margin, outside the final-teardown budget.
        self.campaign.deadline = time.time() + 72 * 3600 + 1200
        with mock.patch.object(self.campaign, 'invoke') as invoke:
            result = self.campaign.run_one('soak-aws')
        invoke.assert_not_called()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['failureReason'], 'insufficient-campaign-time-for-full-soak-and-final-teardown')
        events = supervisor.read_json(self.root / 'soak-aws-observer.json')['events']
        self.assertEqual(events[-1]['event'], 'campaign-time-refused')

    def test_soak_with_full_final_teardown_budget_still_launches(self):
        self.campaign.deadline = time.time() + 72 * 3600 + supervisor.FINAL_OBSERVATION_MARGIN + 60
        with mock.patch.object(self.campaign, 'invoke', return_value=1) as invoke:
            self.campaign.run_one('soak-aws')
        invoke.assert_called_once()

    def test_soak_ending_inside_the_final_teardown_budget_stops_before_observing(self):
        self.running_soak(end_at=int((self.campaign.deadline - 1200) * 1000))
        with mock.patch.object(self.campaign, 'export_run') as export, \
             mock.patch.object(self.campaign, 'wait_for_tick'), \
             mock.patch.object(self.campaign, 'invoke', return_value=1) as invoke:
            result = self.campaign.run_one('soak-aws')
        export.assert_not_called()
        invoke.assert_not_called()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['failureReason'], 'full-soak-end-leaves-no-final-teardown-budget')

    def test_transient_observation_export_failure_is_retried_with_backoff(self):
        run_dir = self.running_soak()
        waits = []
        with mock.patch.object(self.campaign, 'export_run',
                               side_effect=[RuntimeError('transient'), RuntimeError('transient'), None]) as export, \
             mock.patch.object(self.campaign, 'wait_for_tick'), \
             mock.patch.object(self.campaign, 'invoke', side_effect=self.finish_soak(run_dir)), \
             mock.patch.object(supervisor.STOP, 'wait', side_effect=lambda seconds: waits.append(seconds) or False):
            result = self.campaign.run_one('soak-aws')
        self.assertEqual(export.call_count, 3)
        self.assertEqual(waits, [15, 30])
        self.assertEqual(result['status'], 'passed')
        events = [x['event'] for x in supervisor.read_json(self.root / 'soak-aws-observer.json')['events']]
        self.assertEqual(events.count('export-retry'), 2)

    def test_persistent_observation_export_failure_still_fails_the_soak(self):
        run_dir = self.running_soak()
        with mock.patch.object(self.campaign, 'export_run', side_effect=RuntimeError('down')) as export, \
             mock.patch.object(self.campaign, 'wait_for_tick') as wait_for_tick, \
             mock.patch.object(self.campaign, 'invoke', side_effect=self.finish_soak(run_dir)) as invoke, \
             mock.patch.object(supervisor.STOP, 'wait', return_value=False) as wait:
            result = self.campaign.run_one('soak-aws')
        self.assertEqual(export.call_count, supervisor.EXPORT_ATTEMPTS)
        self.assertEqual([call.args[0] for call in wait.call_args_list], [15, 30, 60])
        wait_for_tick.assert_not_called()
        invoke.assert_not_called()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['failureType'], 'RuntimeError')

    def test_final_margin_reserves_resume_budget_slack_and_export_retries(self):
        for module in (supervisor, operator_supervisor):
            with self.subTest(module=module.__name__):
                backoffs = sum(module.EXPORT_BACKOFF * 2 ** i for i in range(module.EXPORT_ATTEMPTS - 1))
                self.assertGreaterEqual(module.SCHEDULING_SLACK, 300)
                self.assertGreaterEqual(module.EXPORT_RETRY_ALLOWANCE, backoffs)
                self.assertGreaterEqual(module.FINAL_OBSERVATION_MARGIN, module.RESUME_BUDGET + 300
                                        + module.EXPORT_RETRY_ALLOWANCE)
                # latest_start relies on the (soak + 4 h) deadline term never binding.
                self.assertGreaterEqual(4 * 3600, module.SETUP_BUDGET + module.FINAL_OBSERVATION_MARGIN)
        # The operator enforces the supervisor's own constants, not copies.
        self.assertIs(ops.SETUP_BUDGET, operator_supervisor.SETUP_BUDGET)
        self.assertIs(ops.latest_start, operator_supervisor.latest_start)

    def test_latest_start_leaves_the_supervisor_deadline_exactly_enough(self):
        for hours in (48, 72):
            with self.subTest(hours=hours):
                c = {'stopAt': 2000000000, 'soakHours': hours}
                start = operator_supervisor.latest_start(c)
                deadline = operator_supervisor.supervisor_deadline(c, start)
                self.assertEqual(deadline - start, hours * 3600 + operator_supervisor.SETUP_BUDGET
                                 + operator_supervisor.FINAL_OBSERVATION_MARGIN)

    def test_launch_rule_exact_boundary(self):
        now = 1900000000.0
        for offset, launched in ((0, True), (-1, False)):
            with self.subTest(offset=offset):
                self.campaign.deadline = now + 72 * 3600 + supervisor.FINAL_OBSERVATION_MARGIN + offset
                with mock.patch.object(supervisor.time, 'time', return_value=now), \
                     mock.patch.object(self.campaign, 'invoke', return_value=1) as invoke:
                    self.campaign.run_one('soak-aws')
                self.assertEqual(invoke.called, launched)

    def test_export_retry_never_starts_after_its_allowance(self):
        self.running_soak()
        clock = [5000.0]

        def slow_failure(_label):
            clock[0] += supervisor.EXPORT_RETRY_ALLOWANCE - 10
            raise RuntimeError('slow')

        with mock.patch.object(self.campaign, 'export_run', side_effect=slow_failure) as export, \
             mock.patch.object(supervisor.time, 'monotonic', side_effect=lambda: clock[0]), \
             mock.patch.object(supervisor.STOP, 'wait', return_value=False) as wait:
            with self.assertRaisesRegex(RuntimeError, 'slow'):
                self.campaign.export_observation('soak-aws')
        self.assertEqual(export.call_count, 1)
        wait.assert_not_called()

    def test_stop_requested_before_a_failed_export_is_not_retried(self):
        supervisor.request_stop('signal-SIGTERM', 15)
        with mock.patch.object(self.campaign, 'export_run', side_effect=RuntimeError('down')) as export, \
             mock.patch.object(supervisor.STOP, 'wait', return_value=False) as wait:
            with self.assertRaisesRegex(supervisor.CampaignStopped, 'campaign-stop-during-export') as raised:
                self.campaign.export_observation('soak-aws')
        self.assertEqual(raised.exception.cause, 'signal-SIGTERM')
        self.assertEqual(export.call_count, 1)
        wait.assert_not_called()

    def test_stop_during_export_backoff_is_not_retried(self):
        self.running_soak()
        with mock.patch.object(self.campaign, 'export_run', side_effect=RuntimeError('down')) as export, \
             mock.patch.object(supervisor.STOP, 'wait', return_value=True):
            supervisor.STOP_REASON = {'cause': 'signal-SIGTERM'}
            result = self.campaign.run_one('soak-aws')
        self.assertEqual(export.call_count, 1)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['stopReason'], 'signal-SIGTERM')


if __name__ == '__main__':
    unittest.main()
