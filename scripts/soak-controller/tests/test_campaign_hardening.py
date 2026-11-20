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
        sleep = mock.patch.object(ops.time, 'sleep')
        sleep.start()
        self.addCleanup(sleep.stop)

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
                       b'Could not connect to the endpoint URL'):
            with self.subTest(stderr=stderr), self.head(254, stderr), self.assertRaises(ops.AwsError):
                self.operator.remote_json('supervisor.json', optional=True)
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
        with contextlib.redirect_stdout(io.StringIO()):
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

    def test_cli_absence_codes_are_parsed_privately(self):
        for stderr, code in (
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

    def token(self, put, stored):
        def aws(service, action, value=None, **kwargs):
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

    def test_token_reaches_the_cli_only_through_stdin(self):
        self.token(lambda _value: {}, lambda: (self.parameter() if len(self.calls) > 1 else self.parameter_missing)())
        _, request, options = next(call for call in self.calls if call[0] == 'put-parameter')
        self.assertNotIn('Value', request)
        self.assertNotIn(TOKEN, json.dumps(request))
        self.assertEqual(options['extra'], ('--value', 'file:///dev/stdin'))
        self.assertEqual(options['secret_stdin'], TOKEN.encode())


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

    def test_stop_during_export_backoff_is_not_retried(self):
        self.running_soak()
        with mock.patch.object(self.campaign, 'export_run', side_effect=RuntimeError('down')) as export, \
             mock.patch.object(supervisor.STOP, 'wait', return_value=True):
            result = self.campaign.run_one('soak-aws')
        self.assertEqual(export.call_count, 1)
        self.assertEqual(result['status'], 'failed')


if __name__ == '__main__':
    unittest.main()
