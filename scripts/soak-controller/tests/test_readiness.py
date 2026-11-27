"""Run bootstrap's readiness invalidation and publication, then `start`'s exact check.

Only the fixed paths are relocated, and the required owner is the test user
instead of root. No privileged, package, or cloud operation runs.
"""
import inspect
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import ops

BOOTSTRAP = (ROOT / 'bootstrap.sh').read_text()
SPEC = 'c' * 64


def block(name):
    return BOOTSTRAP[BOOTSTRAP.index('# %s: begin\n' % name):BOOTSTRAP.index('# %s: end\n' % name)]


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.etc = self.root / 'etc/wharfie-soak'
        self.home = self.root / 'var/lib/wharfie-soak'
        self.etc.mkdir(parents=True)
        self.etc.chmod(0o755)
        self.home.mkdir(parents=True)
        (self.etc / 'campaign.json').write_text(json.dumps({'specSha256': SPEC}))
        self.receipt = self.etc / 'bootstrap-ready.json'
        self.token = self.home / ('creator-token-' + SPEC)
        self.old_receipt = self.home / 'bootstrap-ready.json'

    def relocate(self, text):
        return (text.replace('/etc/wharfie-soak', str(self.etc))
                .replace('/var/lib/wharfie-soak', str(self.home))
                .replace('info.st_uid == 0', 'info.st_uid == %d' % os.getuid()))

    def bootstrap(self, *steps):
        script = 'set -euo pipefail\n' + '\n'.join(self.relocate(step) for step in steps) + '\n'
        return subprocess.run(['bash', '-c', script], capture_output=True, text=True, timeout=60)

    def ready(self, spec=SPEC):
        command = self.relocate(ops.readiness_check(spec))
        result = subprocess.run(['sh', '-c', 'set -eu\n' + command], capture_output=True, text=True, timeout=60)
        return result.returncode == 0

    def stale_receipts(self):
        stale = json.dumps({'ready': True, 'specSha256': SPEC})
        self.receipt.write_text(stale)
        self.old_receipt.write_text(stale)
        self.token.write_text(SPEC)

    def test_stale_receipt_and_a_failed_retry_never_satisfy_start(self):
        self.stale_receipts()
        self.assertTrue(self.ready())
        # A retry that fails anywhere after its first command.
        result = self.bootstrap(block('readiness'), 'echo harness check failed >&2; exit 1')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.receipt.exists())
        self.assertFalse(self.old_receipt.exists())
        # Nor does an earlier attempt's creator token survive a failed retry.
        self.assertFalse(self.token.exists())
        self.assertFalse(self.ready())

    def test_a_complete_bootstrap_publishes_a_spec_bound_receipt(self):
        self.stale_receipts()
        result = self.bootstrap(block('readiness'), block('publish-readiness'))
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(self.receipt.read_text())
        self.assertEqual((receipt['ready'], receipt['specSha256']), (True, SPEC))
        self.assertFalse((self.etc / 'bootstrap-ready.json.tmp').exists())
        self.assertFalse(self.old_receipt.exists())
        self.assertTrue(self.ready())
        # A fresh creator token for this spec is published with the receipt.
        self.assertEqual(self.token.read_text(), SPEC)
        # Another campaign's spec, or a receipt that is not a regular file, fails.
        self.assertFalse(self.ready('d' * 64))
        self.receipt.unlink()
        self.receipt.symlink_to(self.old_receipt)
        self.old_receipt.write_text(json.dumps({'ready': True, 'specSha256': SPEC}))
        self.assertFalse(self.ready())

    def test_a_token_is_issued_at_most_once_per_spec(self):
        result = self.bootstrap(block('readiness'), block('publish-readiness'))
        self.assertEqual(result.returncode, 0, result.stderr)
        issued = self.etc / ('creator-token-issued-' + SPEC)
        self.assertEqual(json.loads(issued.read_text())['specSha256'], SPEC)
        self.assertEqual(self.token.read_text(), SPEC)
        # The reviewer's case: the first start spent the token; bootstrap is
        # then re-run. It republishes the receipt for cleanup-only starts,
        # but never a second token for this spec.
        self.token.unlink()
        result = self.bootstrap(block('readiness'), block('publish-readiness'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(self.ready())
        self.assertFalse(self.token.exists())
        self.assertTrue(issued.exists())
        # After /run is cleared by a reboot, the next start has no token, so
        # it launches nothing.
        sys.path.insert(0, str(ROOT / 'tests'))
        from test_supervisor import supervisor
        with tempfile.TemporaryDirectory() as run:
            from unittest.mock import patch
            with patch.object(supervisor, 'ROOT', self.home), \
                 patch.object(supervisor, 'RUNTIME_LATCH', Path(run) / 'started'):
                self.assertFalse(supervisor.startup_creator(SPEC))

    def test_publication_refuses_a_directory_other_users_can_write(self):
        self.etc.chmod(0o777)
        result = self.bootstrap(block('publish-readiness'))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.receipt.exists())

    def test_invalidation_comes_first_and_publication_last(self):
        body = BOOTSTRAP
        self.assertLess(body.index('# readiness: begin'), body.index('harness_commit=$('))
        self.assertLess(body.index('# readiness: begin'), body.index('disable_os_maintenance\n'))
        publish = body.index('# publish-readiness: begin')
        for check in ('\nverify_os_maintenance\n', 'harness_manifest verify', 'check_bootstrap.py'):
            self.assertLess(body.index(check), publish)
        self.assertNotIn('/var/lib/wharfie-soak/bootstrap-ready.json', body[publish:])
        # Both consumers read the same root-owned receipt.
        unit = (ROOT / 'wharfie-soak.service').read_text()
        self.assertIn('ConditionPathExists=' + ops.READINESS_RECEIPT + '\n', unit)
        self.assertIn('readiness_check(self.config[\'specSha256\'])', inspect.getsource(ops.Operator.start))
        self.assertTrue(ops.READINESS_RECEIPT.startswith('/etc/wharfie-soak/'))


if __name__ == '__main__':
    unittest.main()
