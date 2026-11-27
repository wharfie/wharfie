"""Execute the real harness install fragment against real git and a local origin.

Only the network origin, the install path, the privilege port and npm are
replaced. No root access, network, npm installation, or cloud resources are
required.
"""
import json
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
        self.manifest = self.root / 'opt/harness-manifest.json'
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
        self.assertEqual((self.harness / 'package.json').read_text(), '{"name": "fixture"}\n')
        self.assertTrue((self.harness / 'node_modules/fixture/index.js').exists())
        # The installer never owned git metadata; the manifest is outside the tree.
        self.assertFalse((self.harness / '.git').exists())
        self.assertEqual(sorted(json.loads(self.manifest.read_text())), ['.gitignore', 'package.json'])

    def assert_refused(self, result, message):
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('npm-ci-reached', result.stdout)
        self.assertIn(message, result.stderr)

    def test_installs_the_pinned_commit_and_can_repeat(self):
        for _ in range(2):
            self.assert_installed(self.install())

    def test_retry_never_reuses_a_dirty_checkout_at_the_same_commit(self):
        self.assert_installed(self.install())
        # An earlier attempt left an edit and a stray file, with HEAD still
        # exactly the pinned commit.
        (self.harness / 'package.json').write_text('{"name": "edited"}\n')
        (self.harness / 'stray.js').write_text('left behind\n')
        self.assert_installed(self.install())
        self.assertFalse((self.harness / 'stray.js').exists())

    def test_install_that_changes_the_checkout_is_refused(self):
        for action, message in (
                ('echo changed > package.json', 'harness file changed during npm ci: package.json'),
                ('chmod +x package.json', 'harness file changed during npm ci: package.json'),
                ('rm package.json && ln -s .gitignore package.json', 'harness file changed during npm ci: package.json'),
                ('rm package.json', 'harness file removed during npm ci: package.json'),
                ('echo new > generated.js', 'harness file added during npm ci: generated.js'),
                ('mkdir -p build/cache', 'harness directory added during npm ci: build'),
                # A same-content hard link from a path the installer controls.
                ('mkdir -p node_modules/fixture && ln package.json node_modules/fixture/linked.json',
                 'harness file changed during npm ci: package.json'),
                ('rm package.json && mkfifo package.json', 'harness file changed during npm ci: package.json')):
            with self.subTest(action=action):
                self.npm(action)
                self.assert_refused(self.install(), message)

    def test_installer_git_metadata_has_no_effect_on_the_verdict(self):
        marker = self.root / 'fsmonitor-ran'
        tamper = ('mkdir -p .git/hooks && printf "[core]\\n\\tfsmonitor = touch %s\\n" > .git/config' % marker)
        # With a tracked edit, tampered metadata cannot make the tree look clean.
        self.npm(tamper + ' && echo changed > package.json')
        result = self.install()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('during npm ci', result.stderr)
        self.assertFalse(marker.exists())
        # On its own it is an added directory, and nothing ever runs it.
        self.npm(tamper)
        self.assert_refused(self.install(), 'harness directory added during npm ci: .git')
        self.assertFalse(marker.exists())

if __name__ == '__main__':
    unittest.main()
