"""Diagnostic I/O failures must not alter proof or child/cleanup authority."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ops
from test_supervisor import supervisor, MemoryEvidenceClient


class DiagnosticIsolationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='wharfie-diagnostic-isolation-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        root_patch = patch.object(supervisor, 'ROOT', self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        supervisor.STOP.clear()
        supervisor.STOP_REASON = None
        self.addCleanup(supervisor.STOP.clear)
        self.config = {'campaignId': 'fixture-campaign', 'specSha256': 'a' * 64,
                       'stopAt': time.time() + 80 * 3600, 'soakHours': 72,
                       'bucket': 'fixture-never-contacted'}
        self.client = MemoryEvidenceClient()
        self.campaign = supervisor.Campaign(
            self.config, supervisor.Evidence(self.config, self.client), 'fixture-no-real-token')
        self.label = 'soak-aws'
        self.addCleanup(self.close_logs)

    def close_logs(self):
        logger = supervisor.logging.getLogger(self.label)
        for handler in list(logger.handlers):
            logger.removeHandler(handler)
            handler.close()

    def test_event_disk_failure_is_nonthrowing(self):
        with patch.object(supervisor, 'atomic_json', side_effect=OSError('fixture-full-disk')):
            self.assertFalse(self.campaign.event(self.label, 'child-started', pid=42))

    def test_first_post_spawn_failure_terminates_and_reaps_child(self):
        for missing_process in (False, True):
            with self.subTest(missing_process=missing_process):
                child = Mock(pid=4242, stdout=io.BytesIO())
                with patch.object(supervisor.subprocess, 'Popen', return_value=child), \
                     patch.object(self.campaign, 'event', side_effect=OSError('injected-event-failure')), \
                     patch.object(supervisor.os, 'killpg', side_effect=ProcessLookupError if missing_process else None) as kill:
                    with self.assertRaisesRegex(OSError, 'injected-event-failure'):
                        self.campaign.invoke(self.label, ['--resume'])
                kill.assert_called_once_with(4242, supervisor.signal.SIGTERM)
                child.wait.assert_called_once_with(timeout=900)
                self.assertTrue(child.stdout.closed)

    def test_stalled_health_export_cannot_delay_real_child_deadline_or_accumulate_workers(self):
        started, release = threading.Event(), threading.Event()
        calls = []
        def blocked():
            calls.append(1)
            started.set()
            release.wait(10)
        runner = self.root / 'runner.py'
        runner.write_text('import time\ntime.sleep(30)\n')
        self.campaign.deadline = time.time() + 0.25
        self.campaign.monotonic_deadline = time.monotonic() + 0.25
        began = time.monotonic()
        with patch.object(self.campaign, 'export_controller', side_effect=blocked), \
             patch.object(supervisor, 'NODE', sys.executable), \
             patch.object(supervisor, 'RUNNER', str(runner)), \
             patch.object(supervisor, 'HARNESS', str(self.root)):
            try:
                self.assertEqual(self.campaign.invoke(self.label, ['--resume']), 124)
                self.assertLess(time.monotonic() - began, 4)
                self.assertTrue(started.is_set())
                worker = self.campaign.diagnostic_thread
                for _ in range(100):
                    self.assertFalse(self.campaign.schedule_diagnostics())
                self.assertIs(self.campaign.diagnostic_thread, worker)
                self.assertTrue(worker.daemon)
                self.assertEqual(calls, [1])
                events = supervisor.read_json(self.root / (self.label + '-observer.json'))['events']
                termination = next(item for item in events if item['event'] == 'child-term-requested')
                self.assertEqual(termination['reason'], 'operation-deadline')
                self.assertEqual(events[-1]['exitCode'], -15)
            finally:
                release.set()
                if self.campaign.diagnostic_thread:
                    self.campaign.diagnostic_thread.join(2)

    def test_optional_log_export_failure_preserves_required_manifest(self):
        run = supervisor.safe_relative_run(self.label)
        run.mkdir(parents=True)
        supervisor.atomic_json(run / 'report.json', {'status': 'passed'})
        self.campaign.event(self.label, 'child-exited', exitCode=0)
        self.client.fail_once_suffix = '/observer.json'
        with patch.object(self.campaign, 'export_logs', side_effect=OSError('fixture-log-failure')):
            self.campaign.export_run(self.label)
        manifest = json.loads(self.client.objects['fixture-campaign/runs/soak-aws/export.json'])
        self.assertEqual([entry['key'] for entry in manifest['files']],
                         ['fixture-campaign/runs/soak-aws/report.json'])
        self.assertEqual(manifest['optionalDiagnosticsUnavailable'], ['observer.json', 'diagnostics.tar.gz'])

    def test_required_report_failure_still_prevents_manifest(self):
        run = supervisor.safe_relative_run(self.label)
        run.mkdir(parents=True)
        supervisor.atomic_json(run / 'report.json', {'status': 'passed'})
        self.client.fail_once_suffix = '/report.json'
        with self.assertRaisesRegex(RuntimeError, 'injected-export-failure'):
            self.campaign.export_run(self.label)
        self.assertNotIn('fixture-campaign/runs/soak-aws/export.json', self.client.objects)

    def test_finish_exports_terminal_summary_without_waiting_for_health(self):
        started, release = threading.Event(), threading.Event()
        def blocked():
            started.set()
            release.wait(10)
            raise OSError('fixture-diagnostic-failure')
        with patch.object(self.campaign, 'export_controller', side_effect=blocked):
            try:
                began = time.monotonic()
                self.assertEqual(self.campaign.finish(), 0)
                self.assertLess(time.monotonic() - began, 1)
                self.assertTrue(started.wait(1))
                summary = json.loads(self.client.objects['fixture-campaign/supervisor.json'])
                self.assertEqual(summary['status'], 'failed')
                self.assertTrue(self.campaign.diagnostic_thread.is_alive())
            finally:
                release.set()
                self.campaign.diagnostic_thread.join(2)

    def operator_fixture(self, diagnostics):
        operator = ops.Operator.__new__(ops.Operator)
        operator.root, operator.config = self.root, self.config
        operator.identity = Mock()
        operator.delete_controller = Mock()
        report = json.dumps({'workspaceRemoved': True, 'cleanup': {'status': 'absent'}}).encode()
        key = 'fixture-campaign/runs/soak-aws/report.json'
        manifest = {'campaignId': 'fixture-campaign', 'label': self.label, 'files': [
            {'key': key, 'size': len(report), 'sha256': hashlib.sha256(report).hexdigest()},
            {'key': 'fixture-campaign/runs/soak-aws/diagnostics.tar.gz', 'size': 42, 'sha256': 'b' * 64}]}
        summary = {**self.config, 'status': 'failed', 'runs': {
            self.label: {'cleanupVerifiedAbsent': True, 'proofExported': True}}}
        def remote(suffix, optional=False):
            if suffix == 'supervisor.json':
                return summary
            if suffix.endswith('/export.json'):
                return manifest
            self.assertEqual(suffix, 'supervisor-diagnostics.json')
            self.assertTrue(optional)
            if isinstance(diagnostics, Exception):
                raise diagnostics
            return diagnostics
        def aws(service, action, request, **options):
            self.assertEqual((service, action), ('s3api', 'get-object'))
            if request['Key'] != key:
                # A corrupt downloaded diagnostic must not become evidence.
                Path(options['extra'][0]).write_bytes(b'corrupt diagnostic')
                return {}
            Path(options['extra'][0]).write_bytes(report)
            return {}
        operator.remote_json, operator.aws = remote, Mock(side_effect=aws)
        return operator

    def test_missing_failed_or_foreign_optional_diagnostics_do_not_block_collect_or_teardown(self):
        for diagnostics in (None, OSError('fixture-download-failure'), {'campaignId': 'foreign'}):
            with self.subTest(diagnostics=type(diagnostics).__name__):
                operator = self.operator_fixture(diagnostics)
                with contextlib.redirect_stdout(io.StringIO()):
                    operator.collect()
                    operator.teardown()
                collection = ops.read_json(self.root / 'collection.json')
                self.assertIsNone(collection['diagnosticsSha256'])
                self.assertEqual(len(collection['files']), 1)
                self.assertEqual(collection['optionalDiagnosticsUnavailable'],
                    ['soak-aws/diagnostics.tar.gz', 'supervisor-diagnostics.json'])
                self.assertFalse((self.root / 'collected/soak-aws/diagnostics.tar.gz').exists())
                operator.delete_controller.assert_called_once_with()

    def test_present_valid_health_diagnostics_are_hashed(self):
        operator = self.operator_fixture({'campaignId': 'fixture-campaign', 'diskAvailableBytes': 1})
        with contextlib.redirect_stdout(io.StringIO()):
            operator.collect()
        collection = ops.read_json(self.root / 'collection.json')
        self.assertEqual(collection['diagnosticsSha256'],
                         ops.sha256(self.root / 'collected/supervisor-diagnostics.json'))

    def test_required_download_failure_blocks_collection_and_teardown_authority(self):
        operator = self.operator_fixture(None)
        operator.aws = Mock(side_effect=OSError('fixture-required-download-failure'))
        with self.assertRaisesRegex(OSError, 'fixture-required-download-failure'):
            operator.collect()
        self.assertFalse((self.root / 'collection.json').exists())
        operator.delete_controller.assert_not_called()


if __name__ == '__main__':
    unittest.main()
