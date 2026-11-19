"""Candidate pinning and private S3 staging, using an in-memory transport only."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock
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

    def prepare(self):
        with contextlib.redirect_stdout(io.StringIO()):
            ops.prepare(self.options)
        return ops.Operator(self.options.state)

    def test_parameterizes_identical_harness_and_candidate_commit(self):
        operator = self.prepare()
        self.assertEqual(operator.config['controllerCommit'], self.commit)
        self.assertEqual(operator.config['sourceCommit'], self.commit)
        self.assertEqual(operator.config['version'], '0.0.16')
        rendered = template.render(operator.config)
        userdata = rendered['Resources']['Controller']['Properties']['UserData']['Fn::Base64']['Fn::Sub']
        self.assertLess(len(userdata.encode()), 16384)
        self.assertIn(hashlib.sha256(template.runtime_bundle(operator.config)).hexdigest(), userdata)
        self.assertNotIn('v0.0.15', userdata)

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


if __name__ == '__main__':
    unittest.main()
