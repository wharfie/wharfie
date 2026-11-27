"""Execute the real install fragment with isolated privilege/ownership ports.

No root access, network, npm installation, or cloud resources are required.
"""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMMIT = '8675a2401af072c63c2973f1db42e2f02ea2e566'


class BootstrapRetryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / 'bin'
        self.sbin = self.root / 'sbin'
        self.harness = self.root / 'harness'
        self.bin.mkdir()
        self.sbin.mkdir()
        (self.harness / '.git').mkdir(parents=True)
        self.owner = self.root / 'checkout-owner'
        self.owner.write_text('root:root\n')
        self.command(self.bin / 'timeout', '#!/bin/sh\nshift\nexec "$@"\n')
        self.command(self.bin / 'chown', '#!/bin/sh\nprintf "%s\\n" "$2" > "$TEST_CHECKOUT_OWNER"\n')
        self.command(self.bin / 'git', '''#!/bin/sh
if [ "$(cat "$TEST_CHECKOUT_OWNER")" != root:root ]; then
  echo 'fatal: detected dubious ownership in repository' >&2
  exit 128
fi
if [ "$3" = rev-parse ]; then
  printf '%s\\n' ''' + COMMIT + '''
fi
''')
        self.command(self.bin / 'npm', '#!/bin/sh\nprintf "npm ci reached\\n"\n')
        self.command(self.sbin / 'runuser', '''#!/bin/sh
[ "$1" = -u ] && [ "$2" = wharfie-soak ] && [ "$3" = -- ] || exit 90
shift 3
exec "$@"
''')
        self.environment = {**os.environ, 'PATH': str(self.bin) + ':/usr/bin:/bin',
                            'TEST_CHECKOUT_OWNER': str(self.owner)}

    def command(self, path, content):
        path.write_text(content)
        path.chmod(0o700)

    def fragment(self, repaired):
        source = (ROOT / 'bootstrap.sh').read_text()
        if not repaired:
            source = source.replace('timeout 1200 /usr/sbin/runuser ', 'timeout 1200 runuser ')
            source = source.replace('else\n  # A previous install attempt may have left this checkout owned by the service.\n  chown -R root:root /opt/wharfie-soak/harness\n', '')
        start = source.index('if [ ! -d /opt/wharfie-soak/harness/.git ]; then')
        stop = source.index('timeout 900 python3 /opt/wharfie-soak/ops/download_candidate.py')
        # Relocate only filesystem/privilege ports; execute the unchanged shell
        # control flow and its actual restricted-PATH command resolution.
        selected = source[start:stop]
        selected = selected.replace('/opt/wharfie-soak/harness', str(self.harness))
        selected = selected.replace('/usr/sbin/runuser', str(self.sbin / 'runuser'))
        return 'set -euo pipefail\nharness_commit=' + COMMIT + '\n' + selected

    def run_fragment(self, repaired):
        return subprocess.run(['/bin/bash', '-c', self.fragment(repaired)],
                              env=self.environment, text=True, capture_output=True, timeout=10)

    def test_original_path_failure_leaves_service_owned_checkout(self):
        result = self.run_fragment(False)
        self.assertEqual(result.returncode, 127, result.stderr)
        self.assertNotIn('npm ci reached', result.stdout)
        self.assertEqual(self.owner.read_text().strip(), 'wharfie-soak:wharfie-soak')
        again = self.run_fragment(False)
        self.assertEqual(again.returncode, 128, again.stderr)
        self.assertIn('dubious ownership', again.stderr)

    def test_corrected_fragment_recovers_partial_install_and_can_repeat(self):
        self.owner.write_text('wharfie-soak:wharfie-soak\n')
        for _ in range(2):
            result = self.run_fragment(True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('npm ci reached', result.stdout)
            self.assertEqual(self.owner.read_text().strip(), 'root:root')
        self.assertNotIn(str(self.sbin), self.environment['PATH'])


if __name__ == '__main__':
    unittest.main()
