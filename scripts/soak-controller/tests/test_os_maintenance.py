"""Run bootstrap's OS-maintenance section with a fake systemctl and relocated /etc.

No package, unit, or cloud operation runs. needrestart's configuration is
evaluated by the real perl, as needrestart itself evaluates it.
"""
import contextlib
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
        for name, body in (('systemctl', FAKE_SYSTEMCTL), ('timeout', '#!/bin/bash\nshift\nexec "$@"\n'),
                           ('sleep', '#!/bin/sh\n')):
            (bin_dir / name).write_text(body)
            (bin_dir / name).chmod(0o755)
        self.environment = {'PATH': str(bin_dir) + ':/usr/bin:/bin', 'FAKE_SYSTEMD': str(self.state), 'LANG': 'C'}
        self.dropin = self.root / 'etc/needrestart/conf.d/wharfie-soak.conf'

    def run_section(self, *steps):
        script = 'set -euo pipefail\n' + section().replace('/etc/', str(self.root) + '/etc/') + '\n'.join(steps) + '\n'
        return subprocess.run(['bash', '-c', script], env=self.environment, capture_output=True, text=True, timeout=60)

    @contextlib.contextmanager
    def unit_state(self, unit, kind, value):
        """Set one fake unit property for the block, then restore it."""
        path = self.state / (unit + '.' + kind)
        original = path.read_text() if path.exists() else None
        path.write_text(value + '\n')
        try:
            yield
        finally:
            if original is None:
                path.unlink()
            else:
                path.write_text(original)

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
            active = self.state / (unit + '.active')
            self.assertEqual(active.read_text().strip() if active.exists() else 'inactive', 'inactive')
        self.assertEqual((self.state / 'unattended-upgrades.service.enabled').read_text().strip(), 'disabled')
        self.assertEqual((self.state / 'unattended-upgrades.service.active').read_text().strip(), 'inactive')
        self.assert_verified()
        # A rerun of bootstrap repeats the setup and still verifies.
        self.disable()
        self.assert_verified()

    def test_verification_fails_on_the_stock_image(self):
        self.assert_refused('not masked and inactive')

    def test_verification_accepts_only_exact_maintenance_unit_states(self):
        self.disable()
        for unit in UNITS:
            for kind, value in (('enabled', 'enabled'), ('enabled', 'disabled'), ('enabled', 'enabled-runtime'),
                                ('active', 'active'), ('active', 'activating'), ('active', 'deactivating')):
                with self.subTest(unit=unit, state=kind + '=' + value):
                    with self.unit_state(unit, kind, value):
                        self.assert_refused('not masked and inactive: ' + unit)
        # A unit that finished with an error is not running.
        (self.state / 'apt-daily-upgrade.service.active').write_text('failed\n')
        self.assert_verified()

    def test_verification_accepts_only_a_stopped_disabled_or_absent_unattended_unit(self):
        name = 'unattended-upgrades.service'
        self.disable()
        for kind, value in (('enabled', 'enabled'), ('enabled', 'enabled-runtime'), ('enabled', 'static'),
                            ('active', 'active'), ('active', 'activating'), ('active', 'deactivating')):
            with self.subTest(state=kind + '=' + value):
                with self.unit_state(name, kind, value):
                    self.assert_refused('unattended-upgrades.service is not disabled')
        # An image without the unit is supported.
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

    def log(self):
        return (self.state / 'log').read_text().splitlines()

    def test_running_upgrade_is_waited_for_and_never_stopped(self):
        # The upgrade is already running: "activating" for three more reads.
        (self.state / 'apt-daily-upgrade.service.busy').write_text('3\n')
        self.disable()
        log = self.log()
        self.assertEqual(log[0], 'stop apt-daily.timer apt-daily-upgrade.timer')
        self.assertFalse([line for line in log if line.startswith('stop') and '.service' in line])
        reads = [i for i, line in enumerate(log) if line.startswith('show') and 'apt-daily-upgrade.service' in line]
        self.assertGreaterEqual(len(reads), 4)
        masked = next(i for i, line in enumerate(log) if line.startswith('mask'))
        self.assertGreater(masked, reads[-1])
        self.assert_verified()

    def test_upgrade_that_never_finishes_fails_within_the_bound(self):
        for fail in ('', 'show'):
            with self.subTest(lookup_failure=bool(fail)):
                (self.state / 'apt-daily-upgrade.service.busy').write_text('1000000\n')
                self.environment['FAKE_SYSTEMCTL_FAIL'] = fail
                script = 'set -euo pipefail\n' + section().replace('/etc/', str(self.root) + '/etc/').replace(
                    'apt_drain_seconds=1500', 'apt_drain_seconds=0') + 'disable_os_maintenance\n'
                result = subprocess.run(['bash', '-c', script], env=self.environment, capture_output=True,
                                        text=True, timeout=60)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('apt maintenance still running after 0s: apt-daily-upgrade.service', result.stderr)
                self.assertFalse([line for line in self.log() if line.startswith(('stop', 'mask')) and '.service' in line])

    def userdata_drain(self):
        import sys
        sys.path.insert(0, str(ROOT))
        import template
        from test_controller import config
        userdata = template.render(config())['Resources']['Controller']['Properties']['UserData']['Fn::Base64']['Fn::Sub']
        start = userdata.index('# apt-drain: begin\n')
        drain = userdata[start:userdata.index('# apt-drain: end\n')]
        return userdata, drain

    def test_userdata_suppresses_timers_and_waits_for_a_running_upgrade_before_apt(self):
        userdata, drain = self.userdata_drain()
        self.assertLess(userdata.index('# apt-drain: begin'), userdata.index('apt-get'))
        (self.state / 'apt-daily-upgrade.service.busy').write_text('3\n')
        result = subprocess.run(['bash', '-c', 'set -euo pipefail\n' + drain], env=self.environment,
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stderr)
        log = self.log()
        self.assertEqual(log[0], 'stop apt-daily.timer apt-daily-upgrade.timer')
        self.assertEqual(len([line for line in log if line.startswith('show')]), 4)
        self.assertFalse([line for line in log if line.startswith('stop') and '.service' in line])
        # The real bound is 150 reads 10 s apart; three attempts show its behaviour.
        self.assertIn('$(seq 1 150)', drain)
        self.assertIn('"$attempt" = 150', drain)
        self.assertIn('sleep 10', drain)
        short = drain.replace('$(seq 1 150)', '$(seq 1 3)').replace('"$attempt" = 150', '"$attempt" = 3')
        for busy, fail in (('1000000', ''), ('0', 'show')):
            with self.subTest(busy=busy, fail=fail):
                (self.state / 'apt-daily-upgrade.service.busy').write_text(busy + '\n')
                self.environment['FAKE_SYSTEMCTL_FAIL'] = fail
                result = subprocess.run(['bash', '-c', 'set -euo pipefail\n' + short], env=self.environment,
                                        capture_output=True, text=True, timeout=60)
                self.assertNotEqual(result.returncode, 0)

    def test_every_apt_call_waits_for_the_package_lock(self):
        userdata, _ = self.userdata_drain()
        for name, text in (('bootstrap.sh', BOOTSTRAP), ('userdata', userdata)):
            calls = [line for line in text.splitlines() if 'apt-get ' in line and not line.lstrip().startswith('#')]
            with self.subTest(name=name):
                self.assertEqual(len(calls), 2)
                for line in calls:
                    self.assertIn('apt-get -o DPkg::Lock::Timeout=600 ', line)

    def test_bootstrap_disables_maintenance_before_apt_and_verifies_before_ready(self):
        body = BOOTSTRAP[BOOTSTRAP.index('# os-maintenance: end\n'):]
        self.assertLess(body.index('\ndisable_os_maintenance\n'), body.index('apt-get '))
        self.assertLess(body.index('\nverify_os_maintenance\n'), body.index('bootstrap-ready.json'))
        self.assertGreater(body.index('\nverify_os_maintenance\n'), body.index(' install -y'))


if __name__ == '__main__':
    unittest.main()
