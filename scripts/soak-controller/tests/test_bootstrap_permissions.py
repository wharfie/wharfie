"""Execute the rendered bundle unpack with real restrictive filesystem modes.

Only the three fixed installation paths are relocated. No bootstrap commands,
privileged operations, credentials, package downloads, or cloud calls run.
"""
import base64
import hashlib
import json
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import template
import ops


class BootstrapPermissionsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from test_controller import config
        cls.config = config()
        rendered = template.render(cls.config, root=ROOT)
        cls.userdata = rendered['Resources']['Controller']['Properties'][
            'UserData']['Fn::Base64']['Fn::Sub']

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='wharfie-unpack-test-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.code = self.root / 'opt/wharfie-soak'
        self.ops = self.code / 'ops'
        self.config_dir = self.root / 'etc/wharfie-soak'
        self.service = self.root / 'etc/systemd/system/wharfie-soak.service'
        # These distribution-owned parents already exist on the real host.
        for directory in (self.root / 'opt', self.service.parent):
            directory.mkdir(parents=True, exist_ok=True)
            directory.chmod(0o755)
        python_bin = self.root / 'python-bin'
        python_bin.mkdir()
        (python_bin / 'python3').symlink_to(sys.executable)
        self.environment = {'PATH': str(python_bin) + ':/usr/bin:/bin',
                            'HOME': str(self.root), 'LANG': 'C'}

    def unpack(self, original_modes=False):
        fragment, marker, remainder = self.userdata.partition('\nWHARFIE_BUNDLE\n')
        self.assertTrue(marker)
        self.assertEqual(remainder.strip(),
                         'timeout 3600 bash /opt/wharfie-soak/ops/bootstrap.sh')
        install = fragment[fragment.index("root = pathlib.Path('/opt/wharfie-soak/ops')"):]
        encoded = base64.b64encode(template.runtime_bundle(self.config)).decode()
        fragment = "#!/bin/bash\nset -euo pipefail\numask 077\npython3 - <<'WHARFIE_BUNDLE'\nimport base64,lzma,json,pathlib\nfiles = json.loads(lzma.decompress(base64.b64decode(" + repr(encoded) + ")))\n" + install + marker
        self.assertIn('\numask 077\n', fragment)
        if original_modes:
            # Reproduce the actual pre-fix extraction semantics while keeping
            # the identical compressed runtime bytes and restrictive umask.
            for line in ('root.parent.chmod(0o755)\n', 'root.chmod(0o755)\n',
                         '        path.parent.chmod(0o755)\n'):
                self.assertEqual(fragment.count(line), 1)
                fragment = fragment.replace(line, '')
        for original, relocated in (
                ('/opt/wharfie-soak/ops', self.ops),
                ('/etc/wharfie-soak/campaign.json', self.config_dir / 'campaign.json'),
                ('/etc/systemd/system/wharfie-soak.service', self.service)):
            expression = 'pathlib.Path(' + repr(original) + ')'
            self.assertEqual(fragment.count(expression), 1)
            fragment = fragment.replace(expression,
                                        'pathlib.Path(' + repr(str(relocated)) + ')')
        result = subprocess.run(['/bin/bash', '-s'], input=fragment, text=True,
                                capture_output=True, env=self.environment,
                                cwd=self.root, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)

    def assert_bundle(self):
        for directory in (self.code, self.ops, self.config_dir):
            with self.subTest(directory=directory.relative_to(self.root)):
                self.assertTrue(directory.is_dir())
                self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o755)
        self.assertEqual({path.name for path in self.ops.iterdir()},
                         set(template.RUNTIME_FILES))
        for name in template.RUNTIME_FILES:
            with self.subTest(runtime=name):
                path = self.ops / name
                self.assertEqual(path.read_bytes(), (ROOT / name).read_bytes())
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
        self.assertEqual(self.service.read_bytes(),
                         (ROOT / 'wharfie-soak.service').read_bytes())
        self.assertEqual(stat.S_IMODE(self.service.stat().st_mode), 0o644)
        config_path = self.config_dir / 'campaign.json'
        expected = {key: value for key, value in self.config.items()
                    if key != 'operationsFiles'}
        expected['controllerIpv4'] = '${ControllerAddress}'
        self.assertEqual(config_path.read_bytes(),
                         json.dumps(expected, sort_keys=True).encode())
        self.assertEqual(stat.S_IMODE(config_path.stat().st_mode), 0o644)

    def test_real_v6_userdata_fits_ec2_limit(self):
        self.assertEqual(len(self.config['assets']), 6)
        self.assertLessEqual(len(self.userdata.encode()), 16384)

    def test_unpack_under_private_umask_preserves_bytes_and_readable_code(self):
        self.unpack()
        self.assert_bundle()

    def test_unpack_repairs_existing_private_directories_and_files(self):
        self.unpack(original_modes=True)
        for directory in (self.code, self.ops, self.config_dir):
            self.assertEqual(stat.S_IMODE(directory.stat().st_mode), 0o700)
        for path in (*self.ops.iterdir(), self.config_dir / 'campaign.json', self.service):
            path.chmod(0o600)
        self.unpack()
        self.assert_bundle()

    def test_original_unpack_reproduces_inaccessible_directory_modes(self):
        self.unpack(original_modes=True)
        for directory in (self.code, self.ops, self.config_dir):
            with self.subTest(directory=directory.relative_to(self.root)):
                mode = stat.S_IMODE(directory.stat().st_mode)
                self.assertEqual(mode, 0o700)
                self.assertEqual(mode & (stat.S_IXGRP | stat.S_IXOTH), 0)
        # Public file modes alone cannot repair inaccessible parent directories.
        self.assertEqual(stat.S_IMODE((self.ops / 'supervisor.py').stat().st_mode), 0o644)


if __name__ == '__main__':
    unittest.main()
