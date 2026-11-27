"""Candidate pinning and private S3 staging, using an in-memory transport only."""
import contextlib
import hashlib
import io
import json
import lzma
import os
from pathlib import Path
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import ops
import template
from test_controller import config, fake_gate


class CampaignInputTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.assets = self.root / 'candidate'
        self.assets.mkdir()
        self.commit = '9' * 40
        names = ops.asset_names('0.0.16')
        entries = []
        for name in sorted(names - {'preview-release.json', 'SHA256SUMS'}):
            data = ('fixture:' + name).encode()
            (self.assets / name).write_bytes(data)
            entries.append({'fileName': name, 'size': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        (self.assets / 'preview-release.json').write_text(json.dumps({
            'source': {'repository': 'https://github.com/wharfie/wharfie', 'commit': self.commit},
            'tag': 'v0.0.16', 'version': '0.0.16', 'artifacts': entries,
        }))
        (self.assets / 'SHA256SUMS').write_text(''.join(
            ops.sha256(self.assets / name) + '  ' + name + '\n'
            for name in sorted(names - {'SHA256SUMS'})))
        c = config()
        c['accountId'] = ops.ACCOUNT
        self.preview = self.root / 'preview.json'
        self.preview.write_text(json.dumps(fake_gate(c)['preview']))
        self.options = SimpleNamespace(state=self.root / 'state', preview=self.preview,
            assets=self.assets, campaign='wharfie-soak-test-newcandidate',
            commit=self.commit, version='0.0.16', soak_hours=72)
        # A later controller checkout than the candidate, as for a rerun soak.
        self.controller = 'c' * 40
        checkout = patch.object(ops, 'controller_commit', return_value=self.controller)
        checkout.start()
        self.addCleanup(checkout.stop)
        # The working files stand in for the blobs at that commit.
        frozen = patch.object(ops, 'frozen_operations', side_effect=lambda _head: {
            name: (ops.HERE / name).read_bytes() for name in ops.OPERATIONS_FILES})
        frozen.start()
        self.addCleanup(frozen.stop)

    def prepare(self):
        with contextlib.redirect_stdout(io.StringIO()):
            ops.prepare(self.options)
        return ops.Operator(self.options.state)

    def test_harness_is_the_candidate_commit_and_controller_is_the_checkout(self):
        operator = self.prepare()
        self.assertEqual(operator.config['controllerCommit'], self.controller)
        self.assertEqual(operator.config['sourceCommit'], self.commit)
        ops.controller_commit.assert_called_once_with()
        self.assertEqual(operator.config['version'], '0.0.16')
        rendered = template.render(operator.config)
        userdata = rendered['Resources']['Controller']['Properties']['UserData']['Fn::Base64']['Fn::Sub']
        self.assertLess(len(userdata.encode()), 16384)
        self.assertIn(hashlib.sha256(template.runtime_bundle(operator.config)).hexdigest(), userdata)
        self.assertNotIn('v0.0.15', userdata)

    def test_differing_commits_reach_bootstrap_with_the_harness_at_the_candidate_commit(self):
        operator = self.prepare()
        self.assertNotEqual(operator.config['controllerCommit'], operator.config['sourceCommit'])
        rendered = template.render(operator.config)
        userdata = rendered['Resources']['Controller']['Properties']['UserData']['Fn::Base64']['Fn::Sub']
        bundle = template.runtime_bundle(operator.config)
        self.assertIn(hashlib.sha256(bundle).hexdigest(), userdata)
        files = json.loads(lzma.decompress(bundle))
        campaign = json.loads(files['campaign.json'])
        self.assertEqual((campaign['controllerCommit'], campaign['sourceCommit']), (self.controller, self.commit))
        # Only the gate request carries controllerCommit; nothing on the
        # controller fetches or verifies harness content at it.
        self.assertEqual(sorted(name for name, data in files.items()
                                if name != 'campaign.json' and 'controllerCommit' in data), ['gate.mjs'])
        for name in ('check_bootstrap.py', 'download_candidate.py'):
            self.assertIn("sourceCommit", files[name])

        # Run the bundled bootstrap's harness install with the bundled campaign.
        root = self.root / 'controller'
        bin_dir = root / 'bin'
        bin_dir.mkdir(parents=True)
        (root / 'harness/.git').mkdir(parents=True)
        config_path = root / 'campaign.json'
        config_path.write_text(json.dumps({**campaign, 'controllerIpv4': '192.0.2.15'}))
        log = root / 'git.log'
        for name, body in (
                ('git', '#!/bin/sh\nprintf "%s\\n" "$*" >> "$TEST_GIT_LOG"\n'
                        'if [ "$3" = rev-parse ]; then printf "%s\\n" "$TEST_FETCHED"; fi\n'),
                ('timeout', '#!/bin/sh\nshift\nexec "$@"\n'), ('chown', '#!/bin/sh\n'), ('chmod', '#!/bin/sh\n'),
                ('npm', '#!/bin/sh\necho npm-ci-reached\n'),
                ('runuser', '#!/bin/sh\nshift 3\nexec "$@"\n')):
            (bin_dir / name).write_text(body)
            (bin_dir / name).chmod(0o755)
        source = files['bootstrap.sh']
        selected = (source[source.index('harness_commit=$('):source.index('\n', source.index('harness_commit=$('))]
                    + '\n' + source[source.index('if [ ! -d /opt/wharfie-soak/harness/.git ]; then'):
                                    source.index('timeout 900 python3 /opt/wharfie-soak/ops/download_candidate.py')])
        selected = (selected.replace('/etc/wharfie-soak/campaign.json', str(config_path))
                    .replace('/opt/wharfie-soak/harness', str(root / 'harness'))
                    .replace('/usr/sbin/runuser', str(bin_dir / 'runuser')))
        environment = {**os.environ, 'PATH': str(bin_dir) + ':/usr/bin:/bin', 'TEST_GIT_LOG': str(log),
                       'TEST_FETCHED': self.commit}
        result = subprocess.run(['/bin/bash', '-c', 'set -euo pipefail\n' + selected], env=environment,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('npm-ci-reached', result.stdout)
        calls = log.read_text().splitlines()
        self.assertIn('-C ' + str(root / 'harness') + ' fetch --depth=1 origin ' + self.commit, calls)
        self.assertIn('-C ' + str(root / 'harness') + ' checkout --detach ' + self.commit, calls)
        self.assertNotIn(self.controller, log.read_text())
        # A checkout that landed on the controller commit is refused.
        environment['TEST_FETCHED'] = self.controller
        result = subprocess.run(['/bin/bash', '-c', 'set -euo pipefail\n' + selected], env=environment,
                                capture_output=True, text=True, timeout=30)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('npm-ci-reached', result.stdout)

    def test_prepare_hashes_and_bundles_the_frozen_bytes_not_a_later_file(self):
        committed = {name: (ops.HERE / name).read_bytes() for name in ops.OPERATIONS_FILES}
        committed['bootstrap.sh'] = b'# committed bytes\n' + committed['bootstrap.sh']
        ops.frozen_operations.side_effect = lambda head: dict(committed)
        operator = self.prepare()
        ops.frozen_operations.assert_called_once_with(self.controller)
        self.assertEqual(operator.config['operationsFiles']['bootstrap.sh'],
                         hashlib.sha256(committed['bootstrap.sh']).hexdigest())
        rendered = template.render(operator.config, contents=committed)
        self.assertEqual(rendered, ops.read_json(operator.root / 'cloudformation.json'))
        bundle = json.loads(lzma.decompress(template.runtime_bundle(operator.config, contents=committed)))
        self.assertEqual(bundle['bootstrap.sh'].encode(), committed['bootstrap.sh'])
        # The checkout on disk differs from those bytes, so later commands refuse.
        with self.assertRaisesRegex(RuntimeError, 'reviewed-operations-files-changed'):
            operator.verify_operations_files()

    def test_rejects_wrong_candidate_commit_and_wrong_aws_account(self):
        self.options.commit = '8' * 40
        with self.assertRaises(AssertionError):
            self.prepare()
        self.options.state = self.root / 'second-state'
        self.options.commit = self.commit
        value = json.loads(self.preview.read_text())
        value['providerSpec']['scope']['accountId'] = '000000000000'
        self.preview.write_text(json.dumps(value))
        with self.assertRaises(AssertionError):
            self.prepare()

    def test_stages_every_asset_before_publishing_bootstrap_bundle_and_checks_readback(self):
        operator = self.prepare()
        operator.identity = Mock()
        store, puts = {}, []
        def aws(service, action, value, **kwargs):
            self.assertEqual(service, 's3api')
            if action == 'put-object':
                source = Path(kwargs['extra'][1])
                store[value['Key']] = source.read_bytes()
                self.assertEqual(value['Metadata']['sha256'], ops.sha256(source))
                self.assertEqual(value['ServerSideEncryption'], 'AES256')
                puts.append(value['Key'])
            else:
                self.assertEqual(action, 'get-object')
                Path(kwargs['extra'][0]).write_bytes(store[value['Key']])
            return {}
        operator.aws = aws
        operator.stage_inputs()
        self.assertEqual(len(puts), 7)
        self.assertTrue(puts[-1].endswith('/inputs/operations.json.xz'))
        self.assertTrue(operator.ownership['inputsUploaded'])
        self.assertFalse((operator.root / 'input-readback.tmp').exists())

    def test_changed_assets_refuse_before_any_upload(self):
        operator = self.prepare()
        operator.identity = Mock()
        operator.aws = Mock()
        (self.assets / 'wharfie-aws-0.0.16.tgz').write_text('changed')
        with self.assertRaisesRegex(RuntimeError, 'frozen-candidate-input-changed'):
            operator.stage_inputs()
        operator.aws.assert_not_called()


class ControllerCheckoutCommitTests(unittest.TestCase):
    """controller_commit against a real git repository holding the operations files."""
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repo = Path(temporary.name).resolve() / 'repo'
        self.here = self.repo / 'scripts/soak-controller'
        self.here.mkdir(parents=True)
        for name in ops.OPERATIONS_FILES:
            (self.here / name).write_text('fixture ' + name + '\n')
        (self.repo / 'README.md').write_text('fixture\n')
        self.environment = {'PATH': os.environ['PATH'], 'HOME': temporary.name, 'GIT_CONFIG_NOSYSTEM': '1',
                            'GIT_AUTHOR_NAME': 'f', 'GIT_AUTHOR_EMAIL': 'f@example.invalid',
                            'GIT_COMMITTER_NAME': 'f', 'GIT_COMMITTER_EMAIL': 'f@example.invalid'}
        self.git('init', '-q')
        self.git('add', '-A')
        self.git('commit', '-q', '-m', 'fixture')
        for target, value in ((ops, 'HERE'),):
            here = patch.object(target, value, self.here)
            here.start()
            self.addCleanup(here.stop)
        env = patch.dict(os.environ, self.environment, clear=True)
        env.start()
        self.addCleanup(env.stop)

    def git(self, *arguments):
        return subprocess.run(['git', '-C', str(self.repo), *arguments], env=self.environment,
                              check=True, capture_output=True, text=True).stdout.strip()

    def test_clean_checkout_reports_its_head(self):
        self.assertEqual(ops.controller_commit(), self.git('rev-parse', 'HEAD'))
        # Untracked files outside the operations set do not change the commit's content.
        (self.repo / 'notes.txt').write_text('local notes\n')
        self.assertEqual(ops.controller_commit(), self.git('rev-parse', 'HEAD'))

    def test_frozen_bytes_are_the_committed_blobs(self):
        head = ops.controller_commit()
        frozen = ops.frozen_operations(head)
        self.assertEqual(set(frozen), set(ops.OPERATIONS_FILES))
        for name, data in frozen.items():
            self.assertEqual(data, (self.here / name).read_bytes())

    def test_operations_bytes_that_differ_from_the_commit_are_refused(self):
        # An edit after the clean check, as an editor save during prepare.
        head = ops.controller_commit()
        (self.here / 'bootstrap.sh').write_text('edited during prepare\n')
        with self.assertRaisesRegex(RuntimeError, 'controller-operations-differ-from-commit'):
            ops.frozen_operations(head)
        self.git('checkout', '--', '.')
        # git status trusts index flags; the byte comparison does not.
        self.git('update-index', '--assume-unchanged', 'scripts/soak-controller/supervisor.py')
        (self.here / 'supervisor.py').write_text('hidden from git status\n')
        head = ops.controller_commit()
        with self.assertRaisesRegex(RuntimeError, 'controller-operations-differ-from-commit'):
            ops.frozen_operations(head)

    def test_modified_or_staged_checkout_is_refused(self):
        for staged in (False, True):
            with self.subTest(staged=staged):
                (self.repo / 'README.md').write_text('changed ' + str(staged) + '\n')
                if staged:
                    self.git('add', 'README.md')
                with self.assertRaisesRegex(RuntimeError, 'controller-checkout-has-uncommitted-changes'):
                    ops.controller_commit()
                self.git('reset', '-q', '--hard')

    def test_untracked_operations_file_missing_git_or_repository_is_refused(self):
        self.git('rm', '-q', '--cached', 'scripts/soak-controller/bootstrap.sh')
        self.git('commit', '-q', '-m', 'untrack')
        with self.assertRaisesRegex(RuntimeError, 'controller-checkout-commit-unavailable'):
            ops.controller_commit()
        with patch.dict(os.environ, {'PATH': str(self.repo / 'no-bin')}):
            with self.assertRaisesRegex(RuntimeError, 'controller-checkout-commit-unavailable'):
                ops.controller_commit()
        import shutil
        shutil.rmtree(self.repo / '.git')
        with self.assertRaisesRegex(RuntimeError, 'controller-checkout-commit-unavailable'):
            ops.controller_commit()

    def test_prepare_refuses_a_dirty_checkout_before_writing_state(self):
        (self.repo / 'README.md').write_text('changed\n')
        state = self.repo.parent / 'state'
        options = SimpleNamespace(state=state)
        with self.assertRaisesRegex(RuntimeError, 'controller-checkout-has-uncommitted-changes'):
            ops.prepare(options)
        self.assertFalse(state.exists())


if __name__ == '__main__':
    unittest.main()
