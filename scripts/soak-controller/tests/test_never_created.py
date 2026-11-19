"""A run that never attempted apply settles cleanup without becoming a pass."""
import contextlib
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ops
from test_supervisor import supervisor, MemoryEvidenceClient, TOKEN

RUN_ID = '00000000-0000-4000-8000-000000000001'
PRE_APPLY_PHASES = ['package', 'verify-executable', 'local-cli', 'preview']


def evidence(provider='hetzner'):
    """Runner files for a soak that failed at preview, modelled on November."""
    run = {
        'format': 'wharfie.live-deployment.run.v1', 'runId': RUN_ID, 'provider': provider,
        'deploymentId': 'acceptance-' + RUN_ID, 'deploymentInstanceId': None,
        'applyAttempted': False,
    }
    report = {
        'format': 'wharfie.live-deployment.run.v1', 'mode': 'soak', 'provider': provider,
        'status': 'failed', 'failure': {'phase': 'preview', 'command': 'packaged-app', 'status': 1},
        'cleanup': {'status': 'not-created'}, 'workspaceRemoved': True,
        'phases': [{'phase': name, 'status': 'passed'} for name in PRE_APPLY_PHASES[:-1]] + [
            {'phase': 'preview', 'status': 1, 'result': 'failed'},
            {'phase': 'prepare-removal', 'status': 'passed'},
            {'phase': 'remove-workspace', 'status': 'passed'}],
    }
    retirement = {
        'format': 'wharfie.live-deployment.retirement.v1',
        'binding': {'runId': RUN_ID, 'deploymentId': 'acceptance-' + RUN_ID,
                    'deploymentInstanceId': None, 'provider': provider},
        'cleanup': {'status': 'not-created'},
    }
    cleanup = {
        'format': 'wharfie.live-deployment.run.v1', 'mode': 'cleanup', 'provider': provider,
        'status': 'passed', 'failure': None, 'cleanup': {'status': 'not-created'},
        'workspaceRemoved': True, 'phases': [{'phase': 'remove-workspace', 'status': 'passed'}],
    }
    return {'run.json': run, 'report.json': report, 'retirement.json': retirement,
            'cleanup-report.json': cleanup}


def apply_failure(files):
    """The same run after `prepare-apply` persisted a possible mutation."""
    files['run.json']['applyAttempted'] = True
    files['report.json']['failure'] = {'phase': 'apply', 'command': 'packaged-app', 'status': 1}
    files['report.json']['phases'][-3:] = [
        {'phase': 'preview', 'status': 'passed'}, {'phase': 'preview-next', 'status': 'passed'},
        {'phase': 'prepare-apply', 'status': 'passed'}, {'phase': 'apply', 'status': 1},
        {'phase': 'cleanup', 'status': 1}]
    for name in ('report.json', 'cleanup-report.json'):
        files[name]['cleanup'] = {'status': 'unknown'}
    files['retirement.json']['cleanup'] = {'status': 'unknown'}
    return files


def accepted(files):
    return supervisor.never_created_evidence(
        files['run.json'], files['report.json'], files['retirement.json'], files['cleanup-report.json'])


class NeverCreatedEvidenceTests(unittest.TestCase):
    def test_accepts_exact_pre_apply_failure_evidence(self):
        self.assertTrue(accepted(evidence()))
        files = evidence()
        files['report.json']['failure']['phase'] = 'package'
        files['report.json']['phases'] = [{'phase': 'package', 'status': 1},
                                          {'phase': 'remove-workspace', 'status': 'passed'}]
        self.assertTrue(accepted(files))

    def test_rejects_any_possible_mutation_or_inconsistent_identity(self):
        cases = {
            'deployment identity': lambda f: f['retirement.json']['binding'].update(
                deploymentInstanceId='wsnd1_' + 'A' * 43),
            'run deployment identity': lambda f: f['run.json'].update(deploymentInstanceId='wsnd1_' + 'A' * 43),
            'apply attempted': lambda f: f['run.json'].update(applyAttempted=True),
            'missing apply flag': lambda f: f['run.json'].pop('applyAttempted'),
            'apply phase recorded': lambda f: f['report.json']['phases'].insert(
                4, {'phase': 'prepare-apply', 'status': 'passed'}),
            'later failure phase': lambda f: f['report.json']['failure'].update(phase='apply'),
            'passed report': lambda f: f['report.json'].update(status='passed'),
            'absent instead of not-created': lambda f: f['cleanup-report.json'].update(
                cleanup={'status': 'absent'}),
            'retained workspace': lambda f: f['cleanup-report.json'].update(workspaceRemoved=False),
            'foreign retirement run': lambda f: f['retirement.json']['binding'].update(runId='other'),
            'foreign provider': lambda f: f['retirement.json']['binding'].update(provider='aws'),
            'extra cleanup detail': lambda f: f['retirement.json']['cleanup'].update(reason='lost'),
            'empty phases': lambda f: f['report.json'].update(phases=[]),
        }
        for name, change in cases.items():
            with self.subTest(name):
                files = evidence()
                change(files)
                self.assertFalse(accepted(files))
        self.assertFalse(accepted(apply_failure(evidence())))
        self.assertFalse(supervisor.never_created_evidence([], {}, {}, {}))


class NeverCreatedSupervisorTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='wharfie-never-created-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        root_patch = patch.object(supervisor, 'ROOT', self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        supervisor.STOP.clear()
        supervisor.STOP_REASON = None
        self.addCleanup(supervisor.STOP.clear)
        self.config = {'campaignId': 'fixture-campaign', 'specSha256': 'a' * 64,
                       'sourceCommit': 'b' * 40, 'controllerIpv4': '192.0.2.15',
                       'stopAt': time.time() + 80 * 3600, 'soakHours': 72,
                       'bucket': 'fixture-bucket-never-contacted'}
        self.client = MemoryEvidenceClient()
        process_patch = patch.object(supervisor.subprocess, 'Popen',
                                     side_effect=AssertionError('unexpected subprocess'))
        process_patch.start()
        self.addCleanup(process_patch.stop)
        self.addCleanup(self.close_logs)

    def close_logs(self):
        for label in ('rehearsal-hetzner', 'soak-aws'):
            logger = supervisor.logging.getLogger(label)
            for handler in list(logger.handlers):
                logger.removeHandler(handler)
                handler.close()

    def campaign(self):
        campaign = supervisor.Campaign(self.config, supervisor.Evidence(self.config, self.client), TOKEN)
        def settle_diagnostics():
            if campaign.diagnostic_thread is not None:
                campaign.diagnostic_thread.join(2)
        self.addCleanup(settle_diagnostics)
        return campaign

    def write_run(self, label, files, workspace=False):
        run_dir = supervisor.safe_relative_run(label)
        run_dir.mkdir(parents=True)
        for name, value in files.items():
            supervisor.atomic_json(run_dir / name, value)
        if workspace:
            (run_dir / 'workspace').mkdir(mode=0o700)
        return run_dir

    def test_never_created_run_settles_once_as_failed_and_survives_restart(self):
        label = 'rehearsal-hetzner'
        run_dir = self.write_run(label, evidence())
        campaign = self.campaign()
        outcome = {'provider': 'hetzner', 'label': label, 'status': 'failed', 'complete': False}
        with patch.object(campaign, 'invoke') as invoke, patch.object(supervisor.time, 'sleep') as sleep:
            result = campaign.settle(label, outcome)
        invoke.assert_not_called()
        sleep.assert_not_called()
        self.assertEqual(result['status'], 'failed')
        self.assertIs(result['neverCreated'], True)
        self.assertIs(result['cleanupVerifiedAbsent'], False)
        self.assertIs(result['proofExported'], True)
        self.assertEqual(result['settlementAttempts'], 1)
        self.assertNotIn('fixture-campaign/runs/rehearsal-hetzner/recovery.tar.gz', self.client.puts)
        self.assertIn('fixture-campaign/runs/rehearsal-hetzner/retirement.json', self.client.puts)
        self.assertTrue(supervisor.never_created(run_dir))
        restarted = self.campaign()
        with patch.object(restarted, 'invoke') as invoke_again, \
                patch.object(restarted, 'export_run') as export_again:
            self.assertEqual(restarted.run_one(label), result)
        invoke_again.assert_not_called()
        export_again.assert_not_called()

    def test_retained_workspace_or_attempted_apply_still_requires_packaged_cleanup(self):
        for name, files, workspace in (('workspace', evidence(), True),
                                       ('apply attempted', apply_failure(evidence()), False)):
            with self.subTest(name):
                label = 'soak-aws'
                run_dir = self.write_run(label, files, workspace=workspace)
                campaign = self.campaign()
                with patch.object(campaign, 'invoke', return_value=1) as invoke, \
                        patch.object(supervisor.time, 'sleep'):
                    result = campaign.settle(label, {'provider': 'aws', 'label': label, 'status': 'failed'})
                self.assertEqual(invoke.call_count, 3)
                self.assertIs(result['neverCreated'], False)
                self.assertIs(result['cleanupVerifiedAbsent'], False)
                self.assertEqual(result['status'], 'failed')
                supervisor.shutil.rmtree(run_dir)
                (self.root / 'supervisor.json').unlink()

    def test_never_created_rehearsal_failure_still_blocks_both_soaks(self):
        campaign = self.campaign()
        outcomes = {
            'rehearsal-aws': {'status': 'passed', 'complete': True, 'cleanupVerifiedAbsent': True,
                              'proofExported': True},
            'rehearsal-hetzner': {'status': 'failed', 'complete': False, 'cleanupVerifiedAbsent': False,
                                  'neverCreated': True, 'proofExported': True},
        }
        calls = []
        def run_one(label):
            calls.append(label)
            campaign.state['runs'][label] = outcomes[label]
            return outcomes[label]
        with patch.object(campaign, 'run_one', side_effect=run_one):
            self.assertEqual(campaign.run(), 0)
        self.assertEqual(calls, ['rehearsal-aws', 'rehearsal-hetzner'])
        self.assertEqual(campaign.state['status'], 'failed')

    def test_full_soak_length_and_deadline_follow_the_prepared_campaign(self):
        self.config['soakHours'] = 48
        campaign = self.campaign()
        self.assertEqual(campaign.deadline, campaign.state['startedAt'] + 52 * 3600)
        with patch.object(campaign, 'invoke', return_value=1) as invoke, patch.object(supervisor.time, 'sleep'):
            result = campaign.run_one('soak-aws')
        arguments = invoke.call_args_list[0].args[1]
        self.assertEqual(arguments[arguments.index('--soak-hours') + 1], '48')
        self.assertEqual(result['status'], 'failed')
        for value in (None, 24, 48.0, '72'):
            with self.subTest(value=value):
                with self.assertRaisesRegex(RuntimeError, 'invalid-soak-hours'):
                    supervisor.soak_hours({'soakHours': value})


class NeverCreatedTeardownTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='wharfie-never-created-teardown-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.config = {'campaignId': 'fixture-campaign', 'specSha256': 'a' * 64}

    def operator(self, runs):
        """Collected evidence for each label: (outcome, files)."""
        collected = self.root / 'collected'
        listed = []
        for label, (_outcome, files) in runs.items():
            directory = collected / label
            directory.mkdir(parents=True)
            for name, value in files.items():
                data = json.dumps(value).encode()
                (directory / name).write_bytes(data)
                listed.append({'label': label, 'name': name, 'size': len(data),
                               'sha256': hashlib.sha256(data).hexdigest()})
        summary = {'campaignId': 'fixture-campaign', 'status': 'failed',
                   'runs': {label: outcome for label, (outcome, _files) in runs.items()}}
        ops.atomic_json(collected / 'supervisor.json', summary)
        ops.atomic_json(self.root / 'collection.json', {
            'campaignId': 'fixture-campaign', 'files': listed,
            'summarySha256': ops.sha256(collected / 'supervisor.json')})
        operator = ops.Operator.__new__(ops.Operator)
        operator.root, operator.config = self.root, self.config
        operator.identity = Mock()
        operator.delete_controller = Mock()
        return operator

    def absent_aws(self):
        report = {'status': 'passed', 'workspaceRemoved': True, 'cleanup': {'status': 'absent'}}
        return ({'status': 'passed', 'cleanupVerifiedAbsent': True, 'proofExported': True},
                {'report.json': report})

    def never_created_hetzner(self, files=None):
        return ({'status': 'failed', 'cleanupVerifiedAbsent': False, 'neverCreated': True,
                 'proofExported': True}, files or evidence())

    def test_accepts_collected_never_created_evidence_beside_verified_absence(self):
        operator = self.operator({'rehearsal-aws': self.absent_aws(),
                                  'rehearsal-hetzner': self.never_created_hetzner()})
        operator.teardown()
        operator.delete_controller.assert_called_once_with()

    def test_refuses_never_created_claims_the_collected_evidence_does_not_prove(self):
        identity = evidence()
        identity['retirement.json']['binding']['deploymentInstanceId'] = 'wsnd1_' + 'A' * 43
        missing = evidence()
        del missing['retirement.json']
        passed_claim = self.never_created_hetzner()
        passed_claim[0]['status'] = 'passed'
        cases = {
            'deployment identity': (self.never_created_hetzner(identity), 'not-never-created'),
            'apply attempted': (self.never_created_hetzner(apply_failure(evidence())), 'not-never-created'),
            'uncollected retirement': (self.never_created_hetzner(missing), 'not-collected'),
            'passed outcome': (passed_claim, 'not-never-created'),
            'unsettled apply failure': (({'status': 'failed', 'cleanupVerifiedAbsent': False,
                                          'proofExported': True}, apply_failure(evidence())),
                                        'recover-guest-authority'),
            'unexported proof': (({**self.never_created_hetzner()[0], 'proofExported': False}, evidence()),
                                 'recover-guest-authority'),
        }
        for name, (run, message) in cases.items():
            with self.subTest(name):
                for path in sorted(self.root.rglob('*'), reverse=True):
                    path.rmdir() if path.is_dir() else path.unlink()
                operator = self.operator({'rehearsal-aws': self.absent_aws(), 'rehearsal-hetzner': run})
                with self.assertRaisesRegex(RuntimeError, message):
                    operator.teardown()
                operator.delete_controller.assert_not_called()


class SoakLengthPreparationTests(unittest.TestCase):
    def setUp(self):
        # Reuse the candidate fixture that exercises the real `prepare` checks.
        from test_campaign_inputs import CampaignInputTests
        self.inputs = CampaignInputTests('test_parameterizes_identical_harness_and_candidate_commit')
        self.inputs.setUp()
        self.addCleanup(self.inputs.doCleanups)

    def test_prepare_records_soak_length_and_derives_the_controller_window(self):
        for hours in (48, 72):
            with self.subTest(hours=hours):
                options = copy.copy(self.inputs.options)
                options.state = self.inputs.root / ('state-' + str(hours))
                options.soak_hours = hours
                with contextlib.redirect_stdout(io.StringIO()):
                    ops.prepare(options)
                config = ops.read_json(options.state / 'campaign.json')
                self.assertEqual(config['soakHours'], hours)
                self.assertEqual(config['stopAt'], config['createdAt'] + (hours + 6) * 3600)

    def test_prepare_rejects_an_unsupported_soak_length(self):
        options = copy.copy(self.inputs.options)
        options.soak_hours = 24
        with self.assertRaisesRegex(RuntimeError, 'invalid-soak-hours'):
            ops.prepare(options)


if __name__ == '__main__':
    unittest.main()
