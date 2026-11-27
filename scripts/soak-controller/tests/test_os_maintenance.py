"""Run bootstrap's OS-maintenance section with a fake systemctl and relocated /etc.

No package, unit, or cloud operation runs. needrestart's configuration is
evaluated by the real perl, as needrestart itself evaluates it.
"""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = (ROOT / 'bootstrap.sh').read_text()
UNITS = ('apt-daily.timer', 'apt-daily-upgrade.timer', 'apt-daily.service', 'apt-daily-upgrade.service')
OVERRIDE = '$nrconf{override_rc}->{qr(^wharfie-soak\\.service$)} = 0;\n'

FAKE_SYSTEMCTL = r'''#!/usr/bin/env python3
import os, pathlib, sys
state = pathlib.Path(os.environ['FAKE_SYSTEMD'])
args = sys.argv[1:]
with open(state / 'log', 'a') as log:
    log.write(' '.join(args) + '\n')
command = args[0]
if command in os.environ.get('FAKE_SYSTEMCTL_FAIL', '').split(','):
    sys.exit(1)
units = [a for a in args[1:] if not a.startswith('-')]
def get(unit, kind, default=None):
    path = state / (unit + '.' + kind)
    return path.read_text().strip() if path.exists() else default
def put(unit, kind, value):
    (state / (unit + '.' + kind)).write_text(value + '\n')
if command == 'stop':
    for unit in units:
        put(unit, 'active', 'inactive')
elif command == 'mask':
    for unit in units:
        put(unit, 'enabled', 'masked')
elif command == 'disable':
    for unit in units:
        put(unit, 'enabled', 'disabled')
        if '--now' in args:
            put(unit, 'active', 'inactive')
elif command == 'list-unit-files':
    if get(units[0], 'enabled'):
        print(units[0], get(units[0], 'enabled'), 'enabled')
elif command == 'show':
    names = []
    for index, arg in enumerate(args):
        if arg.startswith('--property='):
            names += arg.split('=', 1)[1].split(',')
        elif arg == '-p':
            names += args[index + 1].split(',')
            units.remove(args[index + 1])
    blocks = []
    for unit in units:
        file = get(unit, 'enabled')
        active = get(unit, 'active', 'inactive')
        busy = int(get(unit, 'busy', '0'))
        if busy:
            # A oneshot upgrade is "activating" while it runs.
            put(unit, 'busy', str(busy - 1))
            active = 'activating'
        values = {'LoadState': 'not-found' if file is None else 'masked' if file == 'masked' else 'loaded',
                  'ActiveState': active, 'UnitFileState': file or ''}
        if '--value' in args:
            blocks.append('\n'.join(values[name] for name in names))
        else:
            blocks.append('\n'.join(name + '=' + values[name] for name in names))
    print('\n\n'.join(blocks))
else:
    sys.exit(2)
'''

# The stock Ubuntu file sets defaults, then evaluates every conf.d file.
NEEDRESTART_CONF = r'''$nrconf{override_rc} = {
    qr(^dbus) => 0,
    qr(^ModemManager) => 0,
};
if(-d q(@ROOT@/etc/needrestart/conf.d)) {
      foreach my $fn (sort <@ROOT@/etc/needrestart/conf.d/*.conf>) {
	      eval do { local $/; open my $fh, $fn or die "ERROR: $!\n"; my $cfg = <$fh>; close($fh); $cfg; };
	      die "Error parsing $fn: $@" if($@);
      }
}
'''


def section():
    start = BOOTSTRAP.index('# os-maintenance: begin\n')
    end = BOOTSTRAP.index('# os-maintenance: end\n')
    return BOOTSTRAP[start:end]


class OsMaintenanceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='wharfie-os-maintenance-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.state = self.root / 'systemd'
        self.state.mkdir()
        # The stock image: daily timers enabled and waiting, upgrades enabled.
        for unit in UNITS + ('unattended-upgrades.service',):
            (self.state / (unit + '.enabled')).write_text('enabled\n')
        for unit in ('apt-daily.timer', 'apt-daily-upgrade.timer', 'unattended-upgrades.service'):
            (self.state / (unit + '.active')).write_text('active\n')
        conf = self.root / 'etc/needrestart/needrestart.conf'
        conf.parent.mkdir(parents=True)
        conf.write_text(NEEDRESTART_CONF.replace('@ROOT@', str(self.root)))
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        for name, body in (('systemctl', FAKE_SYSTEMCTL), ('timeout', '#!/bin/bash\nshift\nexec "$@"\n')):
            (bin_dir / name).write_text(body)
            (bin_dir / name).chmod(0o755)
        self.environment = {'PATH': str(bin_dir) + ':/usr/bin:/bin', 'FAKE_SYSTEMD': str(self.state), 'LANG': 'C'}
        self.dropin = self.root / 'etc/needrestart/conf.d/wharfie-soak.conf'

    def run_section(self, *steps):
        script = 'set -euo pipefail\n' + section().replace('/etc/', str(self.root) + '/etc/') + '\n'.join(steps) + '\n'
        return subprocess.run(['bash', '-c', script], env=self.environment, capture_output=True, text=True, timeout=60)

    def assert_verified(self):
        result = self.run_section('verify_os_maintenance')
        self.assertEqual(result.returncode, 0, result.stderr)

    def assert_refused(self, message):
        result = self.run_section('verify_os_maintenance')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(message, result.stderr)

    def disable(self):
        result = self.run_section('disable_os_maintenance')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_setup_masks_maintenance_and_installs_the_exact_override(self):
        self.disable()
        self.assertEqual(self.dropin.read_text(), OVERRIDE)
        for unit in UNITS:
            self.assertEqual((self.state / (unit + '.enabled')).read_text().strip(), 'masked')
            self.assertEqual((self.state / (unit + '.active')).read_text().strip(), 'inactive')
        self.assertEqual((self.state / 'unattended-upgrades.service.enabled').read_text().strip(), 'disabled')
        self.assertEqual((self.state / 'unattended-upgrades.service.active').read_text().strip(), 'inactive')
        self.assert_verified()
        # A rerun of bootstrap repeats the setup and still verifies.
        self.disable()
        self.assert_verified()

    def test_verification_fails_on_the_stock_image(self):
        self.assert_refused('not masked and inactive')

    def test_verification_accepts_only_exact_maintenance_unit_states(self):
        for unit in UNITS:
            for kind, value in (('enabled', 'enabled'), ('enabled', 'disabled'), ('enabled', 'enabled-runtime'),
                                ('active', 'active'), ('active', 'activating'), ('active', 'deactivating')):
                with self.subTest(unit=unit, state=kind + '=' + value):
                    self.disable()
                    (self.state / (unit + '.' + kind)).write_text(value + '\n')
                    self.assert_refused('not masked and inactive: ' + unit)
        # A unit that finished with an error is not running.
        self.disable()
        (self.state / 'apt-daily-upgrade.service.active').write_text('failed\n')
        self.assert_verified()

    def test_verification_accepts_only_a_stopped_disabled_or_absent_unattended_unit(self):
        name = 'unattended-upgrades.service'
        for kind, value in (('enabled', 'enabled'), ('enabled', 'enabled-runtime'), ('enabled', 'static'),
                            ('active', 'active'), ('active', 'activating'), ('active', 'deactivating')):
            with self.subTest(state=kind + '=' + value):
                self.disable()
                (self.state / (name + '.' + kind)).write_text(value + '\n')
                self.assert_refused('unattended-upgrades.service is not disabled')
        # An image without the unit is supported.
        self.disable()
        (self.state / (name + '.enabled')).unlink()
        self.assert_verified()

    def test_verification_fails_when_systemd_cannot_answer(self):
        self.disable()
        self.environment['FAKE_SYSTEMCTL_FAIL'] = 'show'
        self.assert_refused('OS maintenance unit state unavailable: apt-daily.timer')

    def test_verification_requires_the_main_needrestart_configuration(self):
        self.disable()
        (self.root / 'etc/needrestart/needrestart.conf').unlink()
        self.assert_refused('needrestart configuration is not readable')

    def test_verification_evaluates_conditional_snippets_in_every_loader_context(self):
        # The apt hook runs `needrestart -m u`; a snippet that undoes the
        # override only there, or only without a TTY, must still refuse.
        for content in ("$nrconf{override_rc} = {} if $opt_m eq 'u';\n",
                        "delete $nrconf{override_rc}->{$_} for grep { /wharfie/ } keys %{$nrconf{override_rc}} unless $is_tty;\n",
                        "$nrconf{override_rc} = {} if ($ENV{NEEDRESTART_MODE} // '') eq 'a';\n"):
            with self.subTest(content=content):
                self.disable()
                (self.dropin.parent / 'zz-local.conf').write_text(content)
                self.assert_refused('needrestart may still restart wharfie-soak.service')
        # A conditional snippet that keeps the override everywhere passes.
        self.disable()
        (self.dropin.parent / 'zz-local.conf').write_text("$nrconf{restart} = 'l' if $opt_m eq 'u';\n")
        self.assert_verified()

    def test_verification_fails_when_the_override_is_missing_or_not_exact(self):
        for content in (None, OVERRIDE.replace('= 0', '= 1'), OVERRIDE.replace('^wharfie', 'wharfie'),
                        OVERRIDE + '# extra\n'):
            with self.subTest(content=content):
                self.disable()
                if content is None:
                    self.dropin.unlink()
                else:
                    self.dropin.write_text(content)
                self.assert_refused('needrestart override is not exact')

    def test_verification_fails_when_another_file_undoes_the_override(self):
        for content in ('$nrconf{override_rc} = {};\n',
                        '$nrconf{override_rc}->{qr(^wharfie)} = 1;\n'):
            with self.subTest(content=content):
                self.disable()
                (self.dropin.parent / 'zz-local.conf').write_text(content)
                self.assert_refused('needrestart may still restart wharfie-soak.service')

    def test_bootstrap_disables_maintenance_before_apt_and_verifies_before_ready(self):
        body = BOOTSTRAP[BOOTSTRAP.index('# os-maintenance: end\n'):]
        self.assertLess(body.index('\ndisable_os_maintenance\n'), body.index('apt-get update'))
        self.assertLess(body.index('\nverify_os_maintenance\n'), body.index('bootstrap-ready.json'))
        self.assertGreater(body.index('\nverify_os_maintenance\n'), body.index('apt-get install'))


if __name__ == '__main__':
    unittest.main()
