"""Local-only supervisor regressions: no SDK, network, or real credentials."""
import contextlib
import hashlib
import inspect
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tarfile
import tempfile
import threading
import time
import unittest
import sys
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / 'supervisor.py'
SPEC = importlib.util.spec_from_file_location('supervisor_under_test', MODULE_PATH)
supervisor = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(supervisor)
TOKEN = 'fixture-hetzner-token-not-a-real-credential'
LABELS_FOR_TEST = ('rehearsal-aws', 'rehearsal-hetzner', 'soak-aws', 'soak-hetzner')


class MemoryBody(io.BytesIO):
    def iter_chunks(self, size):
        while chunk := self.read(size):
            yield chunk


class MemoryEvidenceClient:
    """Exercise real evidence hashing/readback against an in-memory transport."""
    def __init__(self):
        self.objects = {}
        self.puts = []
        self.gets = []
        self.fail_once_suffix = None

    def put_object(self, **request):
        key = request['Key']
        self.puts.append(key)
        if self.fail_once_suffix and key.endswith(self.fail_once_suffix):
            self.fail_once_suffix = None
            raise RuntimeError('injected-export-failure')
        data = request['Body'].read()
        if len(data) != request['ContentLength']:
            raise AssertionError('incorrect content length')
        if request['ServerSideEncryption'] != 'AES256':
            raise AssertionError('missing archive encryption request')
        if hashlib.sha256(data).hexdigest() != request['Metadata']['sha256']:
            raise AssertionError('incorrect evidence digest')
        self.objects[key] = data
        return {}

    def get_object(self, **request):
        self.gets.append(request['Key'])
        return {'Body': MemoryBody(self.objects[request['Key']])}


class SupervisorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='wharfie-supervisor-test-')
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name).resolve()
        self.root = self.parent / 'controller'
        self.root.mkdir(mode=0o700)
        self.root_patch = patch.object(supervisor, 'ROOT', self.root)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        supervisor.STOP.clear()
        supervisor.STOP_REASON = None
        supervisor.STOP_RECORD = None
        self.addCleanup(supervisor.STOP.clear)
        self.config = {
            'campaignId': 'fixture-campaign',
            'specSha256': 'a' * 64,
            'sourceCommit': 'b' * 40,
            'stopAt': time.time() + 80 * 3600, 'soakHours': 72,
            'controllerIpv4': '192.0.2.15',
            'bucket': 'fixture-bucket-never-contacted',
        }
        self.client = MemoryEvidenceClient()
        self.evidence = supervisor.Evidence(self.config, self.client)
        # Any accidental child process or SDK entry is a test failure.
        self.process_patch = patch.object(
            supervisor.subprocess, 'Popen', side_effect=AssertionError('unexpected subprocess'))
        self.process_patch.start()
        self.addCleanup(self.process_patch.stop)

    def campaign(self):
        campaign = supervisor.Campaign(self.config, self.evidence, TOKEN)
        def settle_diagnostics():
            if campaign.diagnostic_thread is not None:
                campaign.diagnostic_thread.join(2)
                self.assertFalse(campaign.diagnostic_thread.is_alive())
        self.addCleanup(settle_diagnostics)
        return campaign

    def test_waits_until_anchored_tick_without_launching_or_exporting_busy_work(self):
        campaign = self.campaign()
        label = 'soak-aws'
        clock = [time.time()]
        began = clock[0]
        campaign.monotonic_deadline = clock[0] + 76 * 3600
        started = int(clock[0] * 1000)
        self.write(supervisor.safe_relative_run(label) / 'soak.json', {
            'startedAt': started, 'endAt': started + 259200000, 'intervalMs': 900000,
            'completed': [{}], 'pending': None, 'complete': False,
        })
        waits = []
        def wait(seconds):
            waits.append(seconds)
            clock[0] += seconds
        with patch.object(supervisor.time, 'time', side_effect=lambda: clock[0]), \
             patch.object(supervisor.time, 'monotonic', side_effect=lambda: clock[0]), \
             patch.object(supervisor.STOP, 'wait', side_effect=wait):
            campaign.wait_for_tick(label)
        self.assertAlmostEqual(clock[0], started / 1000 + 900)
        self.assertGreater(clock[0] - began, 899)
        self.assertTrue(waits and max(waits) <= 5)
        self.assertEqual(self.client.puts, [])

    def test_wait_interrupt_preserves_first_cancellation_reason(self):
        campaign = self.campaign()
        label = 'soak-aws'
        started = int(time.time() * 1000)
        self.write(supervisor.safe_relative_run(label) / 'soak.json', {
            'startedAt': started, 'endAt': started + 259200000, 'intervalMs': 900000,
            'completed': [{}], 'pending': None, 'complete': False,
        })
        def stop(_seconds):
            supervisor.request_stop('signal', 15)
            supervisor.request_stop('full-build-start-deadline')
        with patch.object(supervisor.STOP, 'wait', side_effect=stop):
            with self.assertRaisesRegex(RuntimeError, 'campaign-stop-during-wait'):
                campaign.wait_for_tick(label)
        self.assertEqual(supervisor.STOP_REASON['cause'], 'signal')
        self.assertEqual(supervisor.STOP_REASON['signal'], 15)

    @contextlib.contextmanager
    def signal_handlers(self):
        """Install the service's real handlers, self-pipe and watcher; restore after."""
        previous = {sig: signal.getsignal(sig) for sig in supervisor.SIGNAL_CAUSES}
        watcher = supervisor.install_signal_handlers()
        try:
            yield watcher
        finally:
            for sig, handler in previous.items():
                signal.signal(sig, handler)
            read_fd, write_fd = supervisor.SIGNAL_PIPE
            supervisor.SIGNAL_PIPE = None
            supervisor.FIRST_SIGNAL = None
            os.close(write_fd)
            watcher.join(5)
            os.close(read_fd)

    def test_signal_handler_records_a_fixed_signal_reason(self):
        for signum, cause in ((signal.SIGTERM, 'signal-SIGTERM'), (signal.SIGINT, 'signal-SIGINT'),
                              (signal.SIGHUP, 'signal-SIGHUP')):
            with self.subTest(cause=cause), self.signal_handlers():
                supervisor.STOP.clear()
                supervisor.STOP_REASON = None
                supervisor.stop_for_signal(signum, None)
                self.assertTrue(supervisor.STOP.wait(5))
                self.assertEqual(supervisor.STOP_REASON['cause'], cause)
                self.assertEqual(supervisor.STOP_REASON['signal'], int(signum))
                # Only the first signal is the cause.
                supervisor.stop_for_signal(signal.SIGINT if signum != signal.SIGINT else signal.SIGTERM, None)
                self.assertEqual(supervisor.STOP_REASON['cause'], cause)
        self.assertIn('install_signal_handlers()', inspect.getsource(supervisor.main))

    def test_first_of_two_signals_before_consumption_is_the_cause(self):
        read_fd, write_fd = os.pipe()
        self.addCleanup(os.close, read_fd)
        self.addCleanup(os.close, write_fd)
        # Non-blocking, so a handler that never wrote fails here instead of hanging.
        os.set_blocking(read_fd, False)
        with patch.object(supervisor, 'SIGNAL_PIPE', (read_fd, write_fd)):
            try:
                supervisor.stop_for_signal(signal.SIGINT, None)
                supervisor.stop_for_signal(signal.SIGTERM, None)
                # The watcher consumes only after both arrived.
                supervisor.consume_signal()
            finally:
                supervisor.FIRST_SIGNAL = None
        self.assertEqual(supervisor.STOP_REASON['cause'], 'signal-SIGINT')
        self.assertEqual(os.read(read_fd, 64), b'\0\0')

    def test_stop_is_set_before_its_record_is_written(self):
        # Writing may be slow (fsync); launches must already be inhibited.
        seen = []
        with patch.object(supervisor, 'write_stop_record', side_effect=lambda _reason: seen.append(supervisor.STOP.is_set())):
            supervisor.request_stop('full-build-start-deadline')
        self.assertEqual(seen, [True])

    def test_signal_handler_never_takes_the_stop_event_lock(self):
        # The handler can run while the main thread holds STOP's condition lock
        # inside Event.wait or Event.set; it must still return.
        script = (
            'import importlib.util, signal, sys\n'
            'spec = importlib.util.spec_from_file_location("s", sys.argv[1])\n'
            's = importlib.util.module_from_spec(spec); spec.loader.exec_module(s)\n'
            's.install_signal_handlers()\n'
            'with s.STOP._cond:\n'
            '    s.stop_for_signal(signal.SIGTERM, None)\n'
            'print("handler-returned", flush=True)\n'
            'print(s.STOP.wait(5), s.STOP_REASON["cause"])\n')
        self.process_patch.stop()
        result = subprocess.run([sys.executable, '-c', script, str(MODULE_PATH)], capture_output=True,
                                text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.split(), ['handler-returned', 'True', 'signal-SIGTERM'])

    def test_real_signal_during_a_main_thread_wait_stops_with_its_cause(self):
        campaign = self.campaign()
        label = 'rehearsal-aws'
        # The next tick is 5 s away, so a stop that never wakes the wait fails
        # this test quickly instead of hanging it.
        started = int(time.time() * 1000) - 900000 + 5000
        self.write(supervisor.safe_relative_run(label) / 'soak.json', {
            'startedAt': started, 'endAt': started + 2 * 900000 + 300000, 'intervalMs': 900000,
            'completed': [{}], 'pending': None, 'complete': False,
        })
        with self.signal_handlers():
            timer = threading.Timer(0.5, os.kill, (os.getpid(), signal.SIGTERM))
            timer.start()
            began = time.monotonic()
            try:
                with self.assertRaises(supervisor.CampaignStopped) as raised:
                    campaign.wait_for_tick(label)
            finally:
                timer.cancel()
        self.assertLess(time.monotonic() - began, 4)
        self.assertEqual(raised.exception.cause, 'signal-SIGTERM')
        # Persisted when observed, before any settlement.
        self.assertEqual(supervisor.read_json(campaign.state_path)['stopReason']['cause'], 'signal-SIGTERM')

    def running_rehearsal(self, label='rehearsal-aws'):
        run_dir = self.run_fixture(label)
        self.write(run_dir / 'report.json', {'status': 'running', 'workspaceRemoved': False,
                                             'cleanup': {'status': 'unknown'}})
        started = int(time.time() * 1000)
        self.write(run_dir / 'soak.json', {'startedAt': started, 'endAt': started + 3600000,
                                           'intervalMs': 900000, 'completed': [{}], 'pending': None,
                                           'complete': False})
        return run_dir

    def reset_process(self):
        """A fresh supervisor process: no stop requested in memory."""
        supervisor.STOP.clear()
        supervisor.STOP_REASON = None

    def test_signal_stop_reason_reaches_the_outcome_and_survives_a_restarted_run(self):
        # 2026-11-27: needrestart restarted the service during a soak wait. The
        # restarted supervisor finished again and erased the recorded reason.
        label = 'soak-aws'
        run_dir = self.running_rehearsal(label)
        campaign = self.campaign()
        saved_at_cleanup = []

        def clean(_label, _arguments, cleanup=False):
            self.assertTrue(cleanup)
            # The campaign cause is on disk before any cleanup or export.
            saved_at_cleanup.append(supervisor.read_json(campaign.state_path).get('stopReason'))
            self.cleanup_success(run_dir)
            return 0

        def signalled(_seconds):
            supervisor.request_stop('signal-SIGTERM', 15)

        with patch.object(campaign, 'export_observation'), \
             patch.object(campaign, 'invoke', side_effect=clean), \
             patch.object(supervisor.STOP, 'wait', side_effect=signalled):
            outcome = campaign.run_one(label)
        self.assertEqual(saved_at_cleanup[0]['cause'], 'signal-SIGTERM')
        self.assertEqual(outcome['status'], 'failed')
        self.assertEqual(outcome['failureType'], 'CampaignStopped')
        self.assertEqual(outcome['stopReason'], 'signal-SIGTERM')
        self.assertTrue(outcome['cleanupVerifiedAbsent'])
        self.assertEqual(campaign.finish(), 0)
        first = supervisor.read_json(campaign.state_path)
        self.assertEqual(first['stopReason']['cause'], 'signal-SIGTERM')
        self.assertEqual(first['stopReason']['signal'], 15)

        # The restarted process was never asked to stop. It enters through run().
        self.reset_process()
        restarted = self.campaign()
        with patch.object(restarted, 'invoke') as invoke:
            self.assertEqual(restarted.run(), 0)
        invoke.assert_not_called()
        restarted.diagnostic_thread.join(5)
        for summary in (supervisor.read_json(restarted.state_path),
                        json.loads(self.client.objects['fixture-campaign/supervisor.json'])):
            self.assertEqual(summary['stopReason'], first['stopReason'])
            self.assertEqual((summary['finishedAt'], summary['status']), (first['finishedAt'], 'failed'))
            self.assertEqual(summary['runs'], first['runs'])
            self.assertEqual(summary['replays'], 1)
        # The post-restart diagnostics keep the campaign cause.
        diagnostics = json.loads(self.client.objects['fixture-campaign/supervisor-diagnostics.json'])
        self.assertEqual(diagnostics['pid'], os.getpid())
        self.assertEqual(diagnostics['stopReason'], first['stopReason'])
        self.assertEqual(diagnostics['status'], 'failed')
        self.assertTrue(diagnostics['processStopRequested'])
        self.assertNotIn('stopRequested', diagnostics)

    def test_terminal_campaign_restart_never_launches_a_missing_run(self):
        # Finished failed: rehearsals passed, the AWS soak failed with progress
        # and an unexported proof, and the Hetzner soak never started.
        campaign = self.campaign()
        for label in ('rehearsal-aws', 'rehearsal-hetzner'):
            self.saved_outcome(campaign, label, passed=True, settled=True)
        run_dir = self.run_fixture('soak-aws')
        self.cleanup_success(run_dir)
        campaign.state['runs']['soak-aws'] = {
            'provider': 'aws', 'label': 'soak-aws', 'status': 'failed', 'cleanupVerifiedAbsent': True,
            'proofExported': False, 'settlementAttempts': 1}
        campaign.state.update(status='failed', finishedAt=1795760500.0)
        campaign.save()
        restarted = self.campaign()
        exports = []

        def slow_export(label, recovery=False):
            exports.append(label)
            time.sleep(0.5)

        with patch.object(restarted, 'invoke') as invoke, \
             patch.object(restarted, 'export_run', side_effect=slow_export):
            self.assertEqual(restarted.run(), 0)
        invoke.assert_not_called()
        self.assertEqual(exports, ['soak-aws'])
        state = supervisor.read_json(restarted.state_path)
        self.assertNotIn('soak-hetzner', state['runs'])
        self.assertFalse(supervisor.safe_relative_run('soak-hetzner').exists())
        self.assertEqual((state['status'], state['finishedAt']), ('failed', 1795760500.0))
        self.assertTrue(state['runs']['soak-aws']['proofExported'])

    def test_stop_latched_before_finish_survives_restart_and_allows_only_settlement(self):
        label = 'rehearsal-aws'
        run_dir = self.running_rehearsal(label)
        campaign = self.campaign()

        def dies_during_cleanup(_label, _arguments, cleanup=False):
            raise SystemExit(143)

        def interrupted(_seconds):
            supervisor.request_stop('signal-SIGINT', 2)

        # Restart before settlement completes: the process dies in cleanup.
        with patch.object(campaign, 'export_observation'), \
             patch.object(campaign, 'invoke', side_effect=dies_during_cleanup), \
             patch.object(supervisor.STOP, 'wait', side_effect=interrupted), \
             self.assertRaises(SystemExit):
            campaign.run_one(label)
        saved = supervisor.read_json(campaign.state_path)
        self.assertEqual(saved['stopReason']['cause'], 'signal-SIGINT')
        self.assertNotIn('finishedAt', saved)
        original = saved['stopReason']

        self.reset_process()
        restarted = self.campaign()
        calls = []

        def clean(request_label, arguments, cleanup=False):
            calls.append((request_label, arguments, cleanup))
            self.cleanup_success(run_dir)
            return 0

        with patch.object(restarted, 'invoke', side_effect=clean):
            self.assertEqual(restarted.run(), 0)
        self.assertEqual(calls, [(label, ['--cleanup', str(run_dir)], True)])
        self.assertTrue(supervisor.STOP.is_set())
        state = supervisor.read_json(restarted.state_path)
        # The first process's stop, not the restart's latched copy of it.
        self.assertEqual(state['stopReason'], original)
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(set(state['runs']), {label})
        self.assertTrue(state['runs'][label]['cleanupVerifiedAbsent'])
        self.assertTrue(state['runs'][label]['proofExported'])

        # Restart after settlement is saved but before finish: nothing to do.
        del state['finishedAt'], state['status']
        supervisor.atomic_json(restarted.state_path, state)
        self.reset_process()
        again = self.campaign()
        with patch.object(again, 'invoke') as invoke:
            self.assertEqual(again.run(), 0)
        invoke.assert_not_called()
        final = supervisor.read_json(again.state_path)
        self.assertEqual(final['stopReason']['cause'], 'signal-SIGINT')
        self.assertEqual(final['status'], 'failed')
        self.assertEqual(final['runs'], state['runs'])

    def test_stop_seen_only_by_an_export_retry_is_saved_before_cleanup(self):
        label = 'soak-aws'
        run_dir = self.running_rehearsal(label)
        campaign = self.campaign()
        saved_at_cleanup = []
        exports = []

        def export(_label, recovery=False):
            exports.append(recovery)
            if len(exports) == 1:
                raise RuntimeError('injected-export-failure')

        def stopped_during_backoff(_seconds):
            supervisor.request_stop('signal-SIGTERM', 15)
            return True

        def clean(_label, _arguments, cleanup=False):
            saved_at_cleanup.append(supervisor.read_json(campaign.state_path).get('stopReason'))
            self.cleanup_success(run_dir)
            return 0

        with patch.object(campaign, 'export_run', side_effect=export), \
             patch.object(campaign, 'invoke', side_effect=clean), \
             patch.object(campaign, 'wait_for_tick', side_effect=AssertionError('no wait after a stop')), \
             patch.object(supervisor.STOP, 'wait', side_effect=stopped_during_backoff):
            outcome = campaign.run_one(label)
        self.assertEqual(outcome['stopReason'], 'signal-SIGTERM')
        self.assertEqual(saved_at_cleanup[0]['cause'], 'signal-SIGTERM')
        self.assertTrue(outcome['proofExported'])

    def test_stop_during_the_final_export_survives_a_failed_summary_upload(self):
        # A passed rehearsal; the stop arrives during its final export, after
        # settlement began, and the summary upload then fails.
        label = 'rehearsal-aws'
        self.run_fixture(label, passed=True, workspace=False)
        campaign = self.campaign()
        real_put = self.evidence.put_file

        def summary_fails(name, *args, **kwargs):
            if name == 'supervisor.json':
                raise RuntimeError('injected-summary-failure')
            return real_put(name, *args, **kwargs)

        def stopped_during_export(_label, recovery=False):
            supervisor.request_stop('signal-SIGINT', 2)

        with patch.object(campaign, 'export_run', side_effect=stopped_during_export), \
             patch.object(self.evidence, 'put_file', side_effect=summary_fails), \
             patch.object(campaign, 'invoke') as invoke, self.assertRaises(RuntimeError):
            campaign.run()
        invoke.assert_not_called()
        self.assertNotIn('stopReason', supervisor.read_json(campaign.state_path))
        record = supervisor.read_json(supervisor.stop_record_path(self.config['specSha256']))
        self.assertEqual((record['cause'], record['specSha256']), ('signal-SIGINT', self.config['specSha256']))

        self.reset_process()
        restarted = self.campaign()
        with patch.object(restarted, 'invoke') as invoke:
            self.assertEqual(restarted.run(), 0)
        invoke.assert_not_called()
        state = supervisor.read_json(restarted.state_path)
        self.assertEqual(state['stopReason']['cause'], 'signal-SIGINT')
        self.assertEqual(set(state['runs']), {label})
        self.assertEqual(state['status'], 'failed')

    def test_foreign_stop_record_means_recovery_and_never_blocks_ours(self):
        foreign = supervisor.stop_record_path('b' * 64)
        supervisor.atomic_json(foreign, {'specSha256': 'b' * 64, 'cause': 'signal-SIGTERM'})
        campaign = self.campaign()
        self.assertEqual(campaign.durable_stop()['cause'], 'stop-record-ambiguous')
        supervisor.request_stop('signal-SIGINT', 2)
        ours = supervisor.read_json(supervisor.stop_record_path(self.config['specSha256']))
        self.assertEqual(ours['cause'], 'signal-SIGINT')
        self.assertEqual(campaign.durable_stop()['cause'], 'signal-SIGINT')

    def test_failed_export_of_one_label_never_starves_cleanup_of_another(self):
        campaign = self.campaign()
        supervisor.request_stop('signal-SIGTERM', 15)
        campaign.record_stop()
        aws = self.run_fixture('soak-aws')
        self.cleanup_success(aws)
        campaign.state['runs']['soak-aws'] = {'provider': 'aws', 'label': 'soak-aws', 'status': 'failed',
                                               'cleanupVerifiedAbsent': True, 'proofExported': False,
                                               'settlementAttempts': 3}
        hetzner = self.run_fixture('soak-hetzner')
        campaign.state['runs']['soak-hetzner'] = {'provider': 'hetzner', 'label': 'soak-hetzner',
                                                   'status': 'failed', 'settlementAttempts': 0}
        campaign.save()
        real_put = self.evidence.put_file

        def summary_fails(name, *args, **kwargs):
            if name == 'supervisor.json':
                raise RuntimeError('injected-summary-failure')
            return real_put(name, *args, **kwargs)

        cleanups = []

        def clean(label, arguments, cleanup=False):
            cleanups.append(label)
            self.cleanup_success(hetzner)
            return 0

        for restart in range(3):
            with self.subTest(restart=restart):
                self.reset_process()
                restarted = self.campaign()
                with patch.object(restarted, 'invoke', side_effect=clean), \
                     patch.object(self.evidence, 'put_file', side_effect=summary_fails), \
                     self.assertRaises(RuntimeError):
                    restarted.run()
                # The first restart already cleaned the Hetzner guest.
                self.assertEqual(cleanups, ['soak-hetzner'])
                self.assertFalse((hetzner / 'workspace').exists())
                state = supervisor.read_json(restarted.state_path)
                self.assertTrue(state['runs']['soak-hetzner']['cleanupVerifiedAbsent'])
                self.assertNotIn('rehearsal-aws', state['runs'])

    def test_replay_with_an_outstanding_run_export_exits_non_zero(self):
        campaign = self.campaign()
        supervisor.request_stop('signal-SIGTERM', 15)
        campaign.record_stop()
        run_dir = self.run_fixture('soak-aws')
        self.cleanup_success(run_dir)
        campaign.state['runs']['soak-aws'] = {'provider': 'aws', 'label': 'soak-aws', 'status': 'failed',
                                               'cleanupVerifiedAbsent': True, 'proofExported': False,
                                               'settlementAttempts': 0}
        campaign.save()
        self.reset_process()
        restarted = self.campaign()
        # The run export keeps failing; the summary upload succeeds.
        with patch.object(restarted, 'export_run', side_effect=RuntimeError('injected-export-failure')), \
             patch.object(supervisor.time, 'sleep'), \
             self.assertRaisesRegex(RuntimeError, 'settlement-incomplete'):
            restarted.run()
        self.assertIn('fixture-campaign/supervisor.json', self.client.objects)

    def test_terminal_null_stop_reason_is_kept_when_the_replay_is_signalled(self):
        campaign = self.campaign()
        for label in LABELS_FOR_TEST:
            self.saved_outcome(campaign, label, passed=True, settled=True)
        self.assertEqual(campaign.finish(), 0)
        campaign.diagnostic_thread.join(5)
        first = supervisor.read_json(campaign.state_path)
        self.assertIsNone(first['stopReason'])
        self.reset_process()
        restarted = self.campaign()
        supervisor.request_stop('signal-SIGHUP', 1)
        self.assertEqual(restarted.run(), 0)
        restarted.diagnostic_thread.join(5)
        restarted.record_stop()
        final = supervisor.read_json(restarted.state_path)
        self.assertIsNone(final['stopReason'])
        self.assertEqual((final['status'], final['finishedAt']), ('passed', first['finishedAt']))
        diagnostics = json.loads(self.client.objects['fixture-campaign/supervisor-diagnostics.json'])
        self.assertIsNone(diagnostics['stopReason'])
        self.assertEqual(diagnostics['processStopReason']['cause'], 'signal-SIGHUP')
        # Nor does a later restart adopt the replay's own stop record.
        self.reset_process()
        again = self.campaign()
        self.assertEqual(again.run(), 0)
        self.assertIsNone(supervisor.read_json(again.state_path)['stopReason'])

    def settled_rehearsals_and_aws_soak(self, campaign):
        for label in ('rehearsal-aws', 'rehearsal-hetzner'):
            self.saved_outcome(campaign, label, passed=True, settled=True)
        aws = self.run_fixture('soak-aws')
        self.cleanup_success(aws)
        campaign.state['runs']['soak-aws'] = {'provider': 'aws', 'label': 'soak-aws', 'status': 'failed',
                                               'cleanupVerifiedAbsent': True, 'proofExported': True,
                                               'settlementAttempts': 1}
        campaign.save()

    def cleanup_recorder(self, calls, succeed=True):
        def clean(label, arguments, cleanup=False):
            calls.append((label, arguments[0], cleanup))
            if succeed and arguments[0] == '--cleanup':
                self.cleanup_success(supervisor.safe_relative_run(label))
            return 0 if succeed else 1
        return clean

    def clear_root(self):
        for path in self.root.iterdir():
            shutil.rmtree(path) if path.is_dir() else path.unlink()

    def test_crash_between_settlements_cleans_the_surviving_guest_on_first_start(self):
        # The process died while the Hetzner soak ran: its workspace exists
        # without a saved outcome. No stop, no terminal summary.
        for succeed in (False, True):
            with self.subTest(cleanup_succeeds=succeed):
                self.clear_root()
                campaign = self.campaign()
                self.settled_rehearsals_and_aws_soak(campaign)
                hetzner = self.run_fixture('soak-hetzner')
                self.reset_process()
                restarted = self.campaign()
                calls = []
                with patch.object(restarted, 'invoke', side_effect=self.cleanup_recorder(calls, succeed)), \
                     patch.object(supervisor.time, 'sleep'):
                    if succeed:
                        self.assertEqual(restarted.run(), 0)
                    else:
                        # An unsettled existing workspace keeps the exit non-zero.
                        with self.assertRaisesRegex(RuntimeError, 'settlement-incomplete'):
                            restarted.run()
                if restarted.diagnostic_thread is not None:
                    restarted.diagnostic_thread.join(5)
                self.assertTrue(calls)
                self.assertTrue(all(call == ('soak-hetzner', '--cleanup', True) for call in calls))
        self.assertFalse((hetzner / 'workspace').exists())
        state = supervisor.read_json(restarted.state_path)
        self.assertEqual(state['runs']['soak-hetzner']['failureReason'], 'outcome-not-saved')
        self.assertTrue(state['runs']['soak-hetzner']['cleanupVerifiedAbsent'])

    def test_observed_signal_inhibits_dispatch_before_the_stop_is_persisted(self):
        # The stop arrives during the AWS rehearsal's export; the record's
        # directory fsync is slow. The Hetzner rehearsal must not start.
        label = 'rehearsal-aws'
        self.run_fixture(label, passed=True, workspace=False)
        campaign = self.campaign()
        release = threading.Event()
        real_write = supervisor.write_stop_record
        def slow_write(reason):
            release.wait(10)
            real_write(reason)
        calls = []
        with self.signal_handlers(), \
             patch.object(supervisor, 'write_stop_record', side_effect=slow_write), \
             patch.object(campaign, 'export_run', side_effect=lambda *_a, **_k: supervisor.stop_for_signal(signal.SIGINT)), \
             patch.object(campaign, 'invoke', side_effect=self.cleanup_recorder(calls)):
            try:
                self.assertEqual(campaign.run(), 0)
            finally:
                release.set()
        self.assertFalse([call for call in calls if call[1] != '--cleanup'])
        self.assertFalse(supervisor.safe_relative_run('rehearsal-hetzner').exists())
        hetzner = supervisor.read_json(campaign.state_path)['runs']['rehearsal-hetzner']
        self.assertEqual((hetzner['failureType'], hetzner['stopReason']), ('CampaignStopped', 'signal-SIGINT'))

    def test_signal_before_the_campaign_exists_still_prevents_a_launch(self):
        # SIGTERM arrived during startup, before Campaign existed. The stop
        # record is bound first, so it is still written for the next start.
        self.assertLess(inspect.getsource(supervisor.main).index('bind_stop_record'),
                        inspect.getsource(supervisor.main).index('install_signal_handlers()'))
        self.assertNotIn('get_parameter', inspect.getsource(supervisor.main).split('def fetch_token')[0])
        campaign = self.campaign()
        self.saved_outcome(campaign, 'rehearsal-aws', passed=True, settled=True)
        self.reset_process()
        supervisor.bind_stop_record(self.config['specSha256'])
        with self.signal_handlers():
            os.kill(os.getpid(), signal.SIGTERM)
            self.assertTrue(supervisor.STOP.wait(5))
            restarted = self.campaign()
            with patch.object(restarted, 'invoke') as invoke:
                self.assertEqual(restarted.run(), 0)
        invoke.assert_not_called()
        self.assertTrue(supervisor.stop_record_path(self.config['specSha256']).exists())

    def test_failed_or_incomplete_stop_records_mean_cleanup_only_recovery(self):
        path = supervisor.stop_record_path(self.config['specSha256'])
        cases = {
            'failed-rename': None,
            'truncated': '{"specSha256": "' + self.config['specSha256'] + '", "cau',
            'empty': '',
            'digest-only': json.dumps({'specSha256': self.config['specSha256']}),
            'unknown-cause': json.dumps({'specSha256': self.config['specSha256'], 'cause': 'x'}),
            # Our file name, but another campaign's spec inside.
            'wrong-spec': json.dumps({'specSha256': 'b' * 64, 'cause': 'signal-SIGTERM'}),
        }
        for case, content in cases.items():
            with self.subTest(case=case):
                for stale in self.root.glob('stop*'):
                    stale.unlink()
                shutil.rmtree(self.root / 'runs', ignore_errors=True)
                (self.root / 'supervisor.json').unlink(missing_ok=True)
                campaign = self.campaign()
                self.saved_outcome(campaign, 'rehearsal-aws', passed=True, settled=True)
                hetzner = self.run_fixture('rehearsal-hetzner')
                self.reset_process()
                if content is None:
                    # The fsynced temporary file stays; the rename fails.
                    with patch.object(supervisor.os, 'replace', side_effect=OSError('injected')), \
                         patch('sys.stdout', new_callable=io.StringIO) as output:
                        supervisor.request_stop('signal-SIGTERM', 15)
                    self.assertTrue(supervisor.STOP_RECORD_FAILED)
                    self.assertIn('stop-record-write-failed', output.getvalue())
                    self.assertTrue(path.with_name(path.name + '.tmp').exists())
                    self.reset_process()
                    supervisor.STOP_RECORD_FAILED = False
                else:
                    path.write_text(content)
                restarted = self.campaign()
                calls = []
                with patch.object(restarted, 'invoke', side_effect=self.cleanup_recorder(calls)):
                    self.assertEqual(restarted.run(), 0)
                # No new run; the existing Hetzner workspace was cleaned.
                self.assertEqual(calls, [('rehearsal-hetzner', '--cleanup', True)])
                self.assertFalse((hetzner / 'workspace').exists())
                state = supervisor.read_json(restarted.state_path)
                self.assertEqual(state['stopReason']['cause'], 'stop-record-ambiguous')

    def test_failing_hetzner_credential_never_blocks_aws_cleanup(self):
        campaign = self.campaign()
        supervisor.request_stop('signal-SIGTERM', 15)
        campaign.record_stop()
        aws = self.run_fixture('soak-aws')
        hetzner = self.run_fixture('soak-hetzner')
        self.reset_process()
        lookups = []
        def failing_lookup():
            lookups.append(1)
            raise TimeoutError('injected-parameter-timeout')
        restarted = self.campaign()
        restarted.token_source = failing_lookup
        calls = []
        def clean(label, arguments, cleanup=False):
            restarted.token_for(label.split('-')[-1])
            calls.append(label)
            self.cleanup_success(supervisor.safe_relative_run(label))
            return 0
        with patch.object(restarted, 'invoke', side_effect=clean), patch.object(supervisor.time, 'sleep'), \
             self.assertRaisesRegex(RuntimeError, 'settlement-incomplete'):
            restarted.run()
        self.assertEqual(calls, ['soak-aws'])
        self.assertFalse((aws / 'workspace').exists())
        self.assertTrue((hetzner / 'workspace').exists())
        outcome = supervisor.read_json(restarted.state_path)['runs']['soak-hetzner']
        self.assertEqual(outcome['cleanupFailureType'], 'TimeoutError')
        self.assertEqual(len(lookups), outcome['settlementAttempts'])

    def test_every_label_gets_a_first_cleanup_before_any_retry(self):
        # Full two-hour reserve; each failed AWS cleanup takes 31 minutes.
        clock = [1900000000.0]
        self.config['stopAt'] = clock[0] + 7200
        campaign = self.campaign()
        supervisor.request_stop('signal-SIGTERM', 15)
        campaign.record_stop()
        self.run_fixture('soak-aws')
        self.run_fixture('soak-hetzner')
        self.reset_process()
        restarted = self.campaign()
        attempts = []
        def slow_failing_cleanup(label, arguments, cleanup=False):
            attempts.append((label, self.config['stopAt'] - clock[0]))
            clock[0] += 1860 if label == 'soak-aws' else 60
            return 1
        def advance(seconds):
            clock[0] += seconds
        with patch.object(supervisor.time, 'time', side_effect=lambda: clock[0]), \
             patch.object(supervisor.time, 'sleep', side_effect=advance), \
             patch.object(restarted, 'invoke', side_effect=slow_failing_cleanup), \
             self.assertRaisesRegex(RuntimeError, 'settlement-incomplete'):
            restarted.run()
        order = [label for label, _ in attempts]
        self.assertEqual(order[:2], ['soak-aws', 'soak-hetzner'])
        self.assertLess(order.index('soak-hetzner'), [i for i, l in enumerate(order) if l == 'soak-aws'][1]
                        if order.count('soak-aws') > 1 else len(order))
        self.assertGreaterEqual(dict(attempts)['soak-hetzner'], 2400)

    def test_term_handling_child_that_exits_zero_keeps_the_observed_signal(self):
        # The child handles TERM and exits 0; the watcher has not yet set STOP
        # or written the record. The in-memory signal still names the cause.
        campaign = self.campaign()
        runner = self.root / 'fixture-runner.py'
        pid_file = self.root / 'child.pid'
        runner.write_text('import os, signal, sys, time\nsignal.signal(signal.SIGTERM, lambda *a: sys.exit(0))\n'
                          'open(%r, "w").write(str(os.getpid()))\ntime.sleep(30)\n' % str(pid_file))
        self.process_patch.stop()
        def service_stop():
            for _ in range(100):
                if pid_file.exists() and pid_file.read_text():
                    break
                time.sleep(0.05)
            os.kill(int(pid_file.read_text()), signal.SIGTERM)
            os.kill(os.getpid(), signal.SIGTERM)
        with self.signal_handlers(), patch.object(supervisor, 'consume_signal'), \
             patch.multiple(supervisor, NODE=sys.executable, RUNNER=str(runner), HARNESS=str(self.root)), \
             patch.object(campaign, 'settle', side_effect=lambda _label, outcome: outcome):
            stopper = threading.Thread(target=service_stop)
            stopper.start()
            outcome = campaign.run_one('rehearsal-aws')
            stopper.join(10)
        self.assertEqual(outcome['stopReason'], 'signal-SIGTERM')

    def test_run_interrupted_before_its_outcome_was_saved_is_settled_never_resumed(self):
        label = 'rehearsal-aws'
        run_dir = self.running_rehearsal(label)
        campaign = self.campaign()
        supervisor.request_stop('signal-SIGTERM', 15)
        campaign.record_stop()
        self.reset_process()
        restarted = self.campaign()
        calls = []

        def clean(request_label, arguments, cleanup=False):
            calls.append(arguments)
            self.cleanup_success(run_dir)
            return 0

        resumed = AssertionError('an interrupted run must never be resumed')
        with patch.object(restarted, 'invoke', side_effect=clean), \
             patch.object(restarted, 'export_observation', side_effect=resumed), \
             patch.object(restarted, 'wait_for_tick', side_effect=resumed):
            restarted.run()
        self.assertEqual(calls, [['--cleanup', str(run_dir)]])
        outcome = supervisor.read_json(restarted.state_path)['runs'][label]
        self.assertEqual(outcome['failureReason'], 'outcome-not-saved')
        self.assertEqual(outcome['stopReason'], 'signal-SIGTERM')
        self.assertEqual(outcome['status'], 'failed')

    def fixture_runner(self, seconds):
        runner = self.root / 'fixture-runner.py'
        runner.write_text('import time\nprint("fixture-running", flush=True)\ntime.sleep(%d)\n' % seconds)
        self.process_patch.stop()
        return patch.multiple(supervisor, NODE=sys.executable, RUNNER=str(runner), HARNESS=str(self.root))

    def test_signal_while_a_child_runs_reaches_the_run_outcome(self):
        campaign = self.campaign()
        timer = threading.Timer(0.5, supervisor.request_stop, ('signal-SIGTERM', 15))
        with self.fixture_runner(30), patch.object(campaign, 'settle', side_effect=lambda _label, outcome: outcome):
            timer.start()
            try:
                outcome = campaign.run_one('rehearsal-aws')
            finally:
                timer.cancel()
        self.assertEqual(outcome['stopReason'], 'signal-SIGTERM')
        self.assertEqual(supervisor.read_json(campaign.state_path)['stopReason']['cause'], 'signal-SIGTERM')

    def test_service_stop_delivered_to_child_and_supervisor_reaches_the_outcome(self):
        # KillMode=control-group: systemd signals both processes at once, so
        # the child exits -15 before the supervisor terminates it.
        campaign = self.campaign()
        runner = self.root / 'fixture-runner.py'
        pid_file = self.root / 'child.pid'
        runner.write_text('import os, time\nopen(%r, "w").write(str(os.getpid()))\ntime.sleep(30)\n' % str(pid_file))
        self.process_patch.stop()

        def service_stop():
            for _ in range(100):
                if pid_file.exists() and pid_file.read_text():
                    break
                time.sleep(0.05)
            os.kill(int(pid_file.read_text()), signal.SIGTERM)
            os.kill(os.getpid(), signal.SIGTERM)

        with self.signal_handlers(), \
             patch.multiple(supervisor, NODE=sys.executable, RUNNER=str(runner), HARNESS=str(self.root)), \
             patch.object(campaign, 'settle', side_effect=lambda _label, outcome: outcome):
            timer = threading.Thread(target=service_stop)
            timer.start()
            outcome = campaign.run_one('rehearsal-aws')
            timer.join(10)
        self.assertEqual(outcome['stopReason'], 'signal-SIGTERM')

    def test_unrelated_child_failure_gets_no_stop_cause(self):
        for body in ('raise SystemExit(3)\n', 'import os, signal\nos.kill(os.getpid(), signal.SIGKILL)\n'):
            with self.subTest(body=body):
                campaign = self.campaign()
                runner = self.root / 'fixture-runner.py'
                runner.write_text(body)
                self.process_patch.stop()
                with patch.multiple(supervisor, NODE=sys.executable, RUNNER=str(runner), HARNESS=str(self.root)), \
                     patch.object(campaign, 'settle', side_effect=lambda _label, outcome: outcome):
                    outcome = campaign.run_one('rehearsal-aws')
                self.assertNotIn('stopReason', outcome)
                self.assertFalse(supervisor.STOP.is_set())

    def test_deadline_and_child_timeout_are_distinct_from_a_stop(self):
        # Campaign deadline already passed at entry, with no signal.
        campaign = self.campaign()
        campaign.deadline = time.time() - 1
        with patch.object(campaign, 'settle', side_effect=lambda _label, outcome: outcome), \
             patch.object(campaign, 'invoke') as invoke:
            outcome = campaign.run_one('rehearsal-aws')
        invoke.assert_not_called()
        self.assertEqual((outcome['failureType'], outcome['stopReason']), ('CampaignStopped', 'campaign-deadline'))
        self.assertFalse(supervisor.STOP.is_set())
        self.assertNotIn('stopReason', supervisor.read_json(campaign.state_path))
        # The campaign deadline expires while a child runs.
        campaign = self.campaign()
        campaign.deadline = time.time() + 1
        campaign.monotonic_deadline = time.monotonic() + 1
        with self.fixture_runner(30), patch.object(campaign, 'settle', side_effect=lambda _label, outcome: outcome):
            outcome = campaign.run_one('rehearsal-aws')
        self.assertEqual(outcome['stopReason'], 'campaign-deadline')
        # The child's own operation budget expires; the campaign continues.
        label = 'soak-hetzner'
        run_dir = self.running_rehearsal(label)
        campaign = self.campaign()
        with self.fixture_runner(30), patch.object(supervisor, 'RESUME_BUDGET', 1), \
             patch.object(campaign, 'export_observation'), patch.object(campaign, 'wait_for_tick'), \
             patch.object(campaign, 'settle', side_effect=lambda _label, outcome: outcome):
            outcome = campaign.run_one(label)
        self.assertEqual((outcome['observerExitCode'], outcome['stopReason']), (124, 'child-operation-timeout'))
        self.assertFalse(supervisor.STOP.is_set())
        self.assertNotIn('stopReason', supervisor.read_json(campaign.state_path))
        self.assertTrue(run_dir.exists())

    def test_exports_bounded_real_log_bytes_and_fsynced_lifecycle_events(self):
        campaign = self.campaign()
        label = 'soak-aws'
        (self.root / (label + '.log')).write_bytes(b'fixed phase output\n')
        (self.root / (label + '.log.1')).write_bytes(b'previous phase output\n')
        campaign.event(label, 'child-term-requested', pid=42, reason='operation-deadline')
        item = campaign.export_logs(label)
        data = self.client.objects[item['key']]
        self.assertEqual(hashlib.sha256(data).hexdigest(), item['sha256'])
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as archive:
            self.assertEqual(set(archive.getnames()), {label + '.log', label + '.log.1', label + '-observer.json'})
            event = json.load(archive.extractfile(label + '-observer.json'))['events'][0]
            self.assertEqual(event['reason'], 'operation-deadline')
        self.assertNotIn(TOKEN.encode(), data)

    def test_log_export_refuses_symlink_or_excessive_log(self):
        campaign = self.campaign()
        label = 'soak-aws'
        source = self.root / (label + '.log')
        source.symlink_to(self.root / 'supervisor.json')
        with self.assertRaisesRegex(RuntimeError, 'diagnostic-log-limit'):
            campaign.export_logs(label)
        source.unlink()
        with source.open('wb') as output:
            output.truncate(4198401)
        with self.assertRaisesRegex(RuntimeError, 'diagnostic-log-limit'):
            campaign.export_logs(label)

    def test_exports_numeric_controller_health_without_environment(self):
        campaign = self.campaign()
        with patch.dict(os.environ, {'HETZNER_TOKEN': TOKEN}):
            campaign.export_controller()
        data = self.client.objects['fixture-campaign/supervisor-diagnostics.json']
        value = json.loads(data)
        self.assertGreater(value['diskAvailableBytes'], 0)
        self.assertEqual(value['campaignId'], self.config['campaignId'])
        self.assertNotIn(TOKEN.encode(), data)

    def test_real_child_output_is_visible_before_exit_and_stop_cause_is_exportable(self):
        campaign = self.campaign()
        label = 'soak-aws'
        runner = self.root / 'fixture-runner.py'
        runner.write_text("import time\nprint('fixture-running', flush=True)\ntime.sleep(30)\n")
        self.process_patch.stop()
        visible = []
        def stop():
            logfile = self.root / (label + '.log')
            visible.append(logfile.exists() and 'fixture-running' in logfile.read_text())
            supervisor.request_stop('signal', 15)
        timer = threading.Timer(0.5, stop)
        timer.start()
        try:
            with patch.object(supervisor, 'NODE', sys.executable), \
                 patch.object(supervisor, 'RUNNER', str(runner)), \
                 patch.object(supervisor, 'HARNESS', str(self.root)):
                code = campaign.invoke(label, ['--resume'])
        finally:
            timer.cancel()
        self.assertEqual(code, 124)
        self.assertEqual(visible, [True])
        events = supervisor.read_json(self.root / (label + '-observer.json'))['events']
        stopped = next(event for event in events if event['event'] == 'child-term-requested')
        self.assertEqual(stopped['reason'], 'supervisor-stop')
        self.assertEqual(stopped['stopReason']['signal'], 15)
        self.assertEqual(events[-1]['event'], 'child-exited')
        self.assertEqual(events[-1]['exitCode'], -15)
        item = campaign.export_logs(label)
        self.assertIn(item['key'], self.client.objects)

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        supervisor.atomic_json(path, value)

    def run_fixture(self, label='soak-hetzner', passed=False, workspace=True):
        run_dir = supervisor.safe_relative_run(label)
        run_dir.mkdir(parents=True)
        self.write(run_dir / 'run.json', {'provider': label.split('-')[-1], 'runId': 'fixture-run'})
        self.write(run_dir / 'report.json', {
            'status': 'passed' if passed else 'failed',
            'workspaceRemoved': not workspace,
            'cleanup': {'status': 'unknown' if workspace else 'absent'},
        })
        self.write(run_dir / 'soak-progress.json', {
            'complete': passed, 'completedRuns': 288 if passed else 16,
            'observations': {'completedRuns': 288 if passed else 16},
            'endAt': 123456789,
        })
        if workspace:
            (run_dir / 'workspace').mkdir(mode=0o700)
        return run_dir

    def saved_outcome(self, campaign, label, passed=False, settled=False):
        outcome = {
            'provider': label.split('-')[-1], 'label': label,
            'status': 'passed' if passed else 'failed', 'complete': passed,
            'completedRuns': 288 if passed else 16,
            'cleanupVerifiedAbsent': settled, 'proofExported': settled,
            'settlementAttempts': 1 if settled else 0,
        }
        campaign.state['runs'][label] = dict(outcome)
        campaign.save()
        return outcome

    def cleanup_success(self, run_dir):
        shutil.rmtree(run_dir / 'workspace')
        self.write(run_dir / 'cleanup-report.json', {
            'status': 'passed', 'workspaceRemoved': True,
            'cleanup': {'status': 'absent'},
        })

    def test_saved_passed_run_survives_restart_without_any_new_work(self):
        label = 'soak-aws'
        self.run_fixture(label, passed=True, workspace=False)
        original = self.campaign()
        expected = self.saved_outcome(original, label, passed=True, settled=True)
        restarted = self.campaign()
        with patch.object(restarted, 'invoke') as invoke, patch.object(restarted, 'export_run') as export:
            self.assertEqual(restarted.run_one(label), expected)
        invoke.assert_not_called()
        export.assert_not_called()
        self.assertEqual(restarted.state['startedAt'], original.state['startedAt'])
        self.assertEqual(supervisor.read_json(restarted.state_path)['runs'][label], expected)

    def test_completed_report_survives_restart_before_supervisor_outcome_was_saved(self):
        label = 'soak-aws'
        self.run_fixture(label, passed=True, workspace=False)
        campaign = self.campaign()
        with patch.object(campaign, 'invoke') as invoke:
            result = campaign.run_one(label)
        invoke.assert_not_called()
        self.assertEqual(result['status'], 'passed')
        self.assertTrue(result['complete'])
        self.assertEqual(result['completedRuns'], 288)
        self.assertTrue(result['cleanupVerifiedAbsent'])
        self.assertTrue(result['proofExported'])
        self.assertIn('fixture-campaign/runs/soak-aws/export.json', self.client.objects)

    def test_retained_failed_run_retries_export_without_repeating_successful_cleanup(self):
        label = 'soak-hetzner'
        run_dir = self.run_fixture(label)
        original = self.campaign()
        self.saved_outcome(original, label)
        restarted = self.campaign()
        self.client.fail_once_suffix = '/export.json'

        def clean(request_label, arguments, cleanup=False):
            self.assertEqual(request_label, label)
            self.assertEqual(arguments, ['--cleanup', str(run_dir)])
            self.assertTrue(cleanup)
            self.cleanup_success(run_dir)
            return 0

        with patch.object(restarted, 'invoke', side_effect=clean) as invoke, patch.object(supervisor.time, 'sleep') as sleep:
            result = restarted.run_one(label)
        self.assertEqual(invoke.call_count, 1)
        sleep.assert_called_once_with(5)
        self.assertEqual(result['status'], 'failed')
        self.assertFalse(result['complete'])
        self.assertEqual(result['completedRuns'], 16)
        # Cleanup succeeded once; only the export was retried.
        self.assertEqual((result['settlementAttempts'], result['exportAttempts']), (1, 2))
        self.assertTrue(result['cleanupVerifiedAbsent'])
        self.assertTrue(result['proofExported'])
        self.assertFalse((run_dir / 'workspace').exists())
        again = self.campaign()
        with patch.object(again, 'invoke') as invoke_again:
            self.assertEqual(again.run_one(label), result)
        invoke_again.assert_not_called()

    def test_failed_cleanup_has_three_total_attempts_across_restarts_and_exports_recovery(self):
        label = 'soak-hetzner'
        run_dir = self.run_fixture(label)
        (run_dir / 'workspace' / 'app-linux-x64').write_bytes(b'\x7fELF SEA fixture')
        original = self.campaign()
        self.saved_outcome(original, label)
        restarted = self.campaign()
        with patch.object(restarted, 'invoke', return_value=1) as invoke, patch.object(supervisor.time, 'sleep'):
            result = restarted.run_one(label)
        self.assertEqual(invoke.call_count, 3)
        for call in invoke.call_args_list:
            self.assertEqual(call.args, (label, ['--cleanup', str(run_dir)]))
            self.assertEqual(call.kwargs, {'cleanup': True})
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['settlementAttempts'], 3)
        self.assertFalse(result['cleanupVerifiedAbsent'])
        self.assertTrue(result['proofExported'])
        self.assertTrue((run_dir / 'workspace').is_dir())
        recovery_key = 'fixture-campaign/runs/soak-hetzner/recovery.tar.gz'
        self.assertEqual(self.client.puts.count(recovery_key), 3)
        self.assertEqual(self.client.gets.count(recovery_key), 3)
        again = self.campaign()
        with patch.object(again, 'invoke') as invoke_again, patch.object(again, 'export_run') as export_again:
            self.assertEqual(again.run_one(label), result)
        invoke_again.assert_not_called()
        export_again.assert_not_called()

    def test_failed_retained_report_with_stale_progress_never_resumes_work(self):
        label = 'soak-hetzner'
        run_dir = self.run_fixture(label)
        campaign = self.campaign()

        def clean(request_label, arguments, cleanup=False):
            self.assertEqual(request_label, label)
            self.assertEqual(arguments, ['--cleanup', str(run_dir)])
            self.assertTrue(cleanup)
            self.cleanup_success(run_dir)
            return 0

        with patch.object(campaign, 'invoke', side_effect=clean) as invoke:
            result = campaign.run_one(label)
        self.assertEqual(invoke.call_count, 1)
        self.assertEqual(result['status'], 'failed')
        self.assertFalse(result['complete'])
        self.assertEqual(result['completedRuns'], 16)
        self.assertTrue(result['cleanupVerifiedAbsent'])
        self.assertTrue(result['proofExported'])

    def test_new_cleanup_cannot_reuse_a_stale_export_flag_when_final_export_fails(self):
        label = 'soak-hetzner'
        run_dir = self.run_fixture(label)
        campaign = self.campaign()
        previous = self.saved_outcome(campaign, label)
        previous.update(proofExported=True, settlementAttempts=2)
        campaign.state['runs'][label] = previous
        campaign.save()
        restarted = self.campaign()
        self.client.fail_once_suffix = '/export.json'
        persisted_export_flags = []

        def clean(_label, _arguments, cleanup=False):
            self.assertTrue(cleanup)
            persisted_export_flags.append(
                supervisor.read_json(restarted.state_path)['runs'][label]['proofExported'])
            self.cleanup_success(run_dir)
            return 0

        with patch.object(restarted, 'invoke', side_effect=clean) as invoke, patch.object(supervisor.time, 'sleep'):
            result = restarted.run_one(label)
        self.assertEqual(invoke.call_count, 1)
        self.assertEqual(result['settlementAttempts'], 3)
        self.assertTrue(result['cleanupVerifiedAbsent'])
        # The stale flag was cleared before the new cleanup ran; the failed
        # final export is then retried, independently of the cleanup cap.
        self.assertEqual(persisted_export_flags, [False])
        self.assertEqual(result['exportAttempts'], 2)
        self.assertTrue(result['proofExported'])

    def test_external_stop_nearby_preserves_recovery_authority_without_starting_cleanup(self):
        label = 'soak-hetzner'
        run_dir = self.run_fixture(label)
        self.config['stopAt'] = time.time() + 1800
        campaign = self.campaign()
        self.saved_outcome(campaign, label)
        with patch.object(campaign, 'invoke') as invoke, patch.object(campaign, 'export_run') as export:
            result = campaign.run_one(label)
        invoke.assert_not_called()
        export.assert_not_called()
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['settlementDeferred'], 'external-stop-close-preserve-authority')
        self.assertEqual(result['settlementAttempts'], 0)
        self.assertTrue((run_dir / 'workspace').is_dir())

    def test_manual_cleanup_repairs_evidence_without_changing_failed_work_or_automatic_budget(self):
        label = 'soak-hetzner'
        run_dir = self.run_fixture(label)
        campaign = self.campaign()
        previous = self.saved_outcome(campaign, label)
        previous.update(settlementAttempts=3, proofExported=True)
        campaign.state.update(status='failed')
        campaign.state['runs'][label] = previous
        campaign.save()
        persisted_export_flags = []

        def clean(request_label, arguments, cleanup=False):
            self.assertEqual(request_label, label)
            self.assertEqual(arguments, ['--cleanup', str(run_dir)])
            self.assertTrue(cleanup)
            persisted_export_flags.append(
                supervisor.read_json(campaign.state_path)['runs'][label]['proofExported'])
            self.cleanup_success(run_dir)
            return 0

        with patch.object(campaign, 'invoke', side_effect=clean) as invoke:
            self.assertEqual(campaign.repair_cleanup(label), 0)
        self.assertEqual(invoke.call_count, 1)
        self.assertEqual(persisted_export_flags, [False])
        saved = supervisor.read_json(campaign.state_path)
        result = saved['runs'][label]
        self.assertEqual(saved['status'], 'failed')
        self.assertEqual(result['status'], 'failed')
        self.assertFalse(result['complete'])
        self.assertEqual(result['completedRuns'], 16)
        self.assertEqual(result['settlementAttempts'], 3)
        self.assertEqual(result['manualCleanupAttempts'], 1)
        self.assertTrue(result['cleanupVerifiedAbsent'])
        self.assertTrue(result['proofExported'])
        self.assertIn('fixture-campaign/runs/soak-hetzner/export.json', self.client.objects)
        self.assertIn('fixture-campaign/supervisor.json', self.client.objects)

    def test_manual_cleanup_rejects_active_or_passed_authority_without_actions(self):
        label = 'soak-hetzner'
        self.run_fixture(label)
        campaign = self.campaign()
        for campaign_status, run_status in (
            ('failed', 'running'), ('failed', 'passed'),
            ('running', 'failed'), ('passed', 'failed'),
        ):
            with self.subTest(campaign=campaign_status, run=run_status):
                outcome = self.saved_outcome(campaign, label)
                outcome['status'] = run_status
                campaign.state['runs'][label] = outcome
                campaign.state['status'] = campaign_status
                campaign.save()
                before = campaign.state_path.read_bytes()
                with patch.object(campaign, 'invoke') as invoke, patch.object(campaign, 'export_run') as export:
                    with self.assertRaisesRegex(RuntimeError, 'repair-requires-terminal-failed-proof'):
                        campaign.repair_cleanup(label)
                invoke.assert_not_called()
                export.assert_not_called()
                self.assertEqual(campaign.state_path.read_bytes(), before)
                self.assertEqual(self.client.puts, [])

    def test_manual_cleanup_export_failure_keeps_persisted_proof_invalid_and_failed(self):
        label = 'soak-hetzner'
        run_dir = self.run_fixture(label)
        campaign = self.campaign()
        outcome = self.saved_outcome(campaign, label)
        outcome.update(settlementAttempts=3, proofExported=True)
        campaign.state['runs'][label] = outcome
        campaign.state['status'] = 'failed'
        campaign.save()
        self.client.fail_once_suffix = '/export.json'

        def clean(request_label, arguments, cleanup=False):
            self.assertEqual(request_label, label)
            self.assertEqual(arguments, ['--cleanup', str(run_dir)])
            self.assertTrue(cleanup)
            self.cleanup_success(run_dir)
            return 0

        with patch.object(campaign, 'invoke', side_effect=clean) as invoke:
            with self.assertRaisesRegex(RuntimeError, 'injected-export-failure'):
                campaign.repair_cleanup(label)
        self.assertEqual(invoke.call_count, 1)
        self.assertFalse((run_dir / 'workspace').exists())
        saved = supervisor.read_json(campaign.state_path)
        retained = saved['runs'][label]
        self.assertEqual(saved['status'], 'failed')
        self.assertEqual(retained['status'], 'failed')
        self.assertFalse(retained['proofExported'])
        self.assertFalse(retained['complete'])
        self.assertEqual(retained['completedRuns'], 16)
        self.assertEqual(retained['settlementAttempts'], 3)
        self.assertEqual(retained['manualCleanupAttempts'], 1)
        self.assertNotIn('fixture-campaign/runs/soak-hetzner/export.json', self.client.objects)
        self.assertNotIn('fixture-campaign/supervisor.json', self.client.objects)

    def test_recovery_archive_preserves_seas_journal_and_ssh_authority_only_within_run(self):
        run_dir = self.run_fixture()
        fixtures = {
            'workspace/app-linux-x64': (b'\x7fELF SEA revision A fixture', 0o755),
            'workspace/app-next-linux-x64': (b'\x7fELF SEA revision B fixture', 0o755),
            'workspace/data/apps/fixture/control/single-node-deployments/v3/deployment/journal/journal-0000000000000000.json': (b'{"journalId":"fixture-journal"}\n', 0o600),
            'workspace/data/single-node-deployment-ssh/v1/identity/private-key': (b'fixture-private-key-not-an-actual-key\n', 0o600),
            'workspace/data/single-node-deployment-ssh/v1/identity/known-hosts': (b'fixture-host-key-not-an-actual-key\n', 0o600),
        }
        for relative, (data, mode) in fixtures.items():
            path = run_dir / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
            path.chmod(mode)
        unrelated = self.root / 'homes' / 'hetzner' / 'credential-fixture'
        unrelated.parent.mkdir(parents=True)
        unrelated.write_text(TOKEN)
        expected = {str(path.relative_to(self.root)): path.read_bytes()
                    for path in run_dir.rglob('*') if path.is_file()}
        destination = self.root / 'recovery.tar.gz'
        counts = supervisor.recovery_archive(run_dir, destination)
        self.assertEqual(counts, {'files': len(expected), 'uncompressedBytes': sum(map(len, expected.values()))})
        with tarfile.open(destination, 'r:gz') as archive:
            self.assertEqual(set(archive.getnames()), set(expected))
            for member in archive.getmembers():
                self.assertTrue(member.isfile())
                self.assertTrue(member.name.startswith('runs/soak-hetzner/'))
                self.assertNotIn('..', Path(member.name).parts)
                self.assertEqual(archive.extractfile(member).read(), expected[member.name])
            self.assertEqual(archive.getmember('runs/soak-hetzner/workspace/app-linux-x64').mode, 0o755)
            self.assertEqual(archive.getmember('runs/soak-hetzner/workspace/data/single-node-deployment-ssh/v1/identity/private-key').mode, 0o600)
        self.assertTrue((run_dir / 'workspace').is_dir())

    def test_recovery_archive_rejects_file_directory_root_and_ancestor_symlinks(self):
        for kind in ('file', 'directory', 'root', 'ancestor'):
            with self.subTest(kind=kind):
                sandbox = self.parent / kind
                sandbox.mkdir()
                root = sandbox / 'controller'
                root.mkdir()
                outside = sandbox / 'outside'
                outside.mkdir()
                (outside / 'sentinel').write_text('external fixture must not enter archive')
                run_dir = root / 'runs' / 'soak-hetzner'
                if kind == 'ancestor':
                    (root / 'runs').symlink_to(outside, target_is_directory=True)
                    run_dir.mkdir()
                    (run_dir / 'fixture').write_text('run fixture')
                else:
                    run_dir.parent.mkdir()
                    if kind == 'root':
                        run_dir.symlink_to(outside, target_is_directory=True)
                    else:
                        run_dir.mkdir()
                        (run_dir / 'link').symlink_to(
                            outside / 'sentinel' if kind == 'file' else outside,
                            target_is_directory=kind == 'directory')
                destination = root / 'recovery.tar.gz'
                with patch.object(supervisor, 'ROOT', root):
                    with self.assertRaises(RuntimeError):
                        supervisor.recovery_archive(run_dir, destination)
                self.assertFalse(destination.exists())
                self.assertEqual((outside / 'sentinel').read_text(), 'external fixture must not enter archive')

    def test_provider_environments_do_not_inherit_ambient_secrets(self):
        ambient = {
            'AWS_PROFILE': 'fixture-profile', 'AWS_ACCESS_KEY_ID': 'fixture-access-key',
            'AWS_SECRET_ACCESS_KEY': 'fixture-secret-key', 'AWS_SESSION_TOKEN': 'fixture-session',
            'AWS_WEB_IDENTITY_TOKEN_FILE': '/fixture/token', 'HCLOUD_TOKEN': 'wrong-fixture-token',
            'HETZNER_TOKEN': 'wrong-fixture-token', 'GITHUB_TOKEN': 'fixture-github-token',
            'NODE_AUTH_TOKEN': 'fixture-npm-token', 'SSH_AUTH_SOCK': '/fixture/agent',
            'NODE_OPTIONS': '--require=/fixture/untrusted.js',
        }
        with patch.dict(os.environ, ambient):
            aws = supervisor.provider_environment('aws', TOKEN)
            hetzner = supervisor.provider_environment('hetzner', TOKEN)
        for name in ambient:
            self.assertNotIn(name, aws)
            if name != 'HCLOUD_TOKEN':
                self.assertNotIn(name, hetzner)
        self.assertNotIn(TOKEN, aws.values())
        self.assertEqual(hetzner['HCLOUD_TOKEN'], TOKEN)
        self.assertFalse(any(name.startswith('AWS_') for name in hetzner))
        self.assertEqual(aws['AWS_REGION'], 'us-east-2')
        self.assertEqual(aws['AWS_DEFAULT_REGION'], 'us-east-2')
        self.assertNotEqual(aws['HOME'], hetzner['HOME'])
        self.assertEqual(aws['PATH'], '/opt/wharfie-soak/node/bin:/usr/bin:/bin')
        with self.assertRaisesRegex(RuntimeError, 'invalid-provider'):
            supervisor.provider_environment('unexpected', TOKEN)


if __name__ == '__main__':
    unittest.main()
