"""Execute the real harness install fragment against real git and a local origin.

Only the network origin, the install path, the privilege port and npm are
replaced. No root access, network, npm installation, or cloud resources are
required.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class BootstrapRetryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.harness = self.root / 'opt/harness'
        self.harness.parent.mkdir()
        self.environment = {
            'PATH': str(self.bin) + ':' + os.environ['PATH'], 'HOME': str(self.root), 'LANG': 'C',
            'GIT_CONFIG_NOSYSTEM': '1', 'GIT_AUTHOR_NAME': 'f', 'GIT_AUTHOR_EMAIL': 'f@example.invalid',
            'GIT_COMMITTER_NAME': 'f', 'GIT_COMMITTER_EMAIL': 'f@example.invalid'}
        # The origin holds the candidate commit; node_modules is ignored there.
        self.origin = self.root / 'origin'
        self.origin.mkdir()
        (self.origin / 'package.json').write_text('{"name": "fixture"}\n')
        (self.origin / '.gitignore').write_text('node_modules/\n')
        self.git(self.origin, 'init', '-q')
        self.git(self.origin, 'config', 'uploadpack.allowReachableSHA1InWant', 'true')
        self.git(self.origin, 'config', 'uploadpack.allowFilter', 'true')
        self.git(self.origin, 'add', '-A')
        self.git(self.origin, 'commit', '-q', '-m', 'candidate')
        self.commit = self.git(self.origin, 'rev-parse', 'HEAD')
        # A later commit on the origin: only the pinned one may be installed.
        (self.origin / 'package.json').write_text('{"name": "later"}\n')
        self.git(self.origin, 'commit', '-q', '-am', 'later')
        self.command('timeout', '#!/bin/sh\nshift\nexec "$@"\n')
        self.command('chown', '#!/bin/sh\n')
        self.command('runuser', '#!/bin/sh\n[ "$1" = -u ] && [ "$2" = wharfie-soak ] && [ "$3" = -- ] || exit 90\n'
                                'shift 3\nexec "$@"\n')
        self.npm('mkdir -p node_modules/fixture && echo installed > node_modules/fixture/index.js')

    def git(self, cwd, *arguments):
        return subprocess.run(['git', '-C', str(cwd), *arguments], env=self.environment, check=True,
                              capture_output=True, text=True).stdout.strip()

    def command(self, name, content):
        (self.bin / name).write_text(content)
        (self.bin / name).chmod(0o755)

    def npm(self, action):
        # runuser runs npm under `env -i`, so the fake carries its action inline.
        self.command('npm', '#!/bin/sh\nset -e\n' + action + '\necho npm-ci-reached\n')

    def fragment(self):
        source = (ROOT / 'bootstrap.sh').read_text()
        selected = source[source.index('# harness: begin\n'):source.index('# harness: end\n')]
        selected = (selected.replace('https://github.com/wharfie/wharfie.git', 'file://' + str(self.origin))
                    .replace('/opt/wharfie-soak/harness', str(self.harness))
                    .replace('/usr/sbin/runuser', str(self.bin / 'runuser')))
        return 'set -euo pipefail\nharness_commit=' + self.commit + '\n' + selected

    def install(self):
        return subprocess.run(['/bin/bash', '-c', self.fragment()], env=self.environment, text=True,
                              capture_output=True, timeout=120)

    def assert_installed(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('npm-ci-reached', result.stdout)
        self.assertEqual(self.git(self.harness, 'rev-parse', 'HEAD'), self.commit)
        self.assertEqual((self.harness / 'package.json').read_text(), '{"name": "fixture"}\n')
        self.assertTrue((self.harness / 'node_modules/fixture/index.js').exists())

    def test_installs_the_pinned_commit_and_can_repeat(self):
        for _ in range(2):
            self.assert_installed(self.install())

    def test_retry_never_reuses_a_dirty_checkout_at_the_same_commit(self):
        self.assert_installed(self.install())
        # An earlier attempt left an edit and a stray file, with HEAD still
        # exactly the pinned commit.
        (self.harness / 'package.json').write_text('{"name": "edited"}\n')
        (self.harness / 'stray.js').write_text('left behind\n')
        self.assertEqual(self.git(self.harness, 'rev-parse', 'HEAD'), self.commit)
        self.assert_installed(self.install())
        self.assertFalse((self.harness / 'stray.js').exists())

    def test_install_that_changes_the_checkout_is_refused(self):
        for action in ('echo changed > package.json',
                       'echo new > generated.js',
                       'git commit -q --allow-empty -m moved'):
            with self.subTest(action=action):
                self.npm('export GIT_AUTHOR_NAME=f GIT_AUTHOR_EMAIL=f@example.invalid '
                         'GIT_COMMITTER_NAME=f GIT_COMMITTER_EMAIL=f@example.invalid\n' + action)
                result = self.install()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('npm-ci-reached', result.stdout)
                self.assertIn('harness checkout changed during npm ci', result.stderr)

    def test_git_failure_after_install_is_not_read_as_clean(self):
        self.npm('rm -rf .git')
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('npm-ci-reached', result.stdout)


if __name__ == '__main__':
    unittest.main()
