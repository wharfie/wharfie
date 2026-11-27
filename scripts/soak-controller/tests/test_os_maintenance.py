"""Run bootstrap's OS-maintenance section with a fake systemctl and relocated /etc.

No package, unit, or cloud operation runs. needrestart's configuration is
evaluated by the real perl, as needrestart itself evaluates it.
"""
import contextlib
import hashlib
from pathlib import Path
import subprocess
import tempfile
import time
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
    import time
    time.sleep(float(os.environ.get('FAKE_SHOW_DELAY', '0')))
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

# Enforces its duration, as coreutils timeout does: 124 on expiry.
FAKE_TIMEOUT = r'''#!/usr/bin/env python3
import subprocess, sys
try:
    sys.exit(subprocess.run(sys.argv[2:], timeout=float(sys.argv[1])).returncode)
except subprocess.TimeoutExpired:
    sys.exit(124)
'''

# FAKE_APT=lock:N fails N times on the lists lock; FAKE_APT=fail fails otherwise.
FAKE_APT_GET = r'''#!/bin/sh
count=$(($(cat "$FAKE_SYSTEMD/apt-calls" 2>/dev/null || echo 0) + 1))
echo "$count" > "$FAKE_SYSTEMD/apt-calls"
echo "apt-get $*" >> "$FAKE_SYSTEMD/log"
case ${FAKE_APT:-} in
  lock:*)
    if [ "$count" -le "${FAKE_APT#lock:}" ]; then
      echo 'E: Could not get lock /var/lib/apt/lists/lock. It is held by process 4242 (apt-get)' >&2
      exit 100
    fi ;;
  fail) echo 'E: Failed to fetch http://archive.ubuntu.com/ubuntu' >&2; exit 100 ;;
esac
echo 'Reading package lists... Done'
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
        self.conf = conf
        self.conffiles = {}
        self.package(conf)
        bin_dir = self.root / 'bin'
        bin_dir.mkdir()
        for name, body in (('systemctl', FAKE_SYSTEMCTL), ('timeout', FAKE_TIMEOUT), ('apt-get', FAKE_APT_GET),
                           ('sleep', '#!/bin/sh\n'),
                           ('dpkg-query', '#!/bin/sh\n[ -z "$FAKE_DPKG_FAIL" ] || exit 1\n'
                                          '[ "$3" = needrestart ] || exit 2\ncat "$FAKE_SYSTEMD/conffiles"\n')):
            (bin_dir / name).write_text(body)
            (bin_dir / name).chmod(0o755)
        self.environment = {'PATH': str(bin_dir) + ':/usr/bin:/bin', 'FAKE_SYSTEMD': str(self.state), 'LANG': 'C'}
        self.dropin = self.root / 'etc/needrestart/conf.d/wharfie-soak.conf'

    def run_section(self, *steps):
        script = 'set -euo pipefail\n' + section().replace('/etc/', str(self.root) + '/etc/') + '\n'.join(steps) + '\n'
        return subprocess.run(['bash', '-c', script], env=self.environment, capture_output=True, text=True, timeout=60)

    def package(self, path, content=None):
        """Write `content` and record it as an unmodified packaged conffile."""
        if content is not None:
            # A fixture that does not compile would pass the control vacuously.
            check = subprocess.run(['perl', '-c', '-e', content], capture_output=True, text=True)
            self.assertEqual(check.returncode, 0, check.stderr)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self.conffiles[str(path)] = hashlib.md5(path.read_bytes()).hexdigest()
        (self.state / 'conffiles').write_text(
            ''.join(' %s %s\n' % item for item in self.conffiles.items()))

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

    def test_only_the_packaged_configuration_plus_the_override_is_supported(self):
        refused = 'needrestart configuration is not the packaged set plus the override'
        snippet = self.conf.parent / 'conf.d/local.conf'
        self.disable()
        self.assert_verified()
        # An unmodified packaged snippet is allowed.
        self.package(snippet, "$nrconf{restart} = 'l';\n")
        self.assert_verified()
        # A modified packaged snippet, or any unpackaged one, is not.
        snippet.write_text("$nrconf{restart} = 'a';\n")
        self.assert_refused(refused)
        del self.conffiles[str(snippet)]
        self.package(self.conf)
        self.assert_refused(refused)
        snippet.unlink()
        self.assert_verified()
        # A modified or missing main file, or no package answer, refuses.
        original = self.conf.read_text()
        self.conf.write_text(original + '# local edit\n')
        self.assert_refused(refused)
        self.conf.unlink()
        self.assert_refused(refused)
        self.conf.write_text(original)
        self.environment['FAKE_DPKG_FAIL'] = '1'
        self.assert_refused(refused)

    def test_positive_control_evaluates_the_apt_hook_context(self):
        # The packaged main file is trusted only as far as this evaluation:
        # a rule that undoes the override in the apt hook's context refuses.
        self.disable()
        original = self.conf.read_text()
        for condition, refused in (("$opt_m eq 'u'", True),
                                   ("($ENV{NEEDRESTART_MODE} // '') eq 'a'", True),
                                   ("$nrconf{has_pam_systemd}", True),
                                   ("!defined $opt_r", True),
                                   ("$opt_m eq 'e'", False)):
            with self.subTest(condition=condition):
                self.package(self.conf, original + '$nrconf{override_rc} = {} if ' + condition + ';\n')
                if refused:
                    self.assert_refused('needrestart may still restart wharfie-soak.service')
                else:
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
                self.assert_refused('needrestart configuration is not the packaged set plus the override')
                (self.dropin.parent / 'zz-local.conf').unlink()

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
        # The real budget is 25 minutes of wall time; 2 s shows its behaviour.
        self.assertIn('drain_deadline=$((SECONDS + 1500))', drain)
        short = drain.replace('drain_deadline=$((SECONDS + 1500))', 'drain_deadline=$((SECONDS + 2))')
        for busy, fail, delay in (('1000000', '', '0'), ('0', 'show', '0'), ('0', '', '3')):
            with self.subTest(busy=busy, fail=fail, delay=delay):
                (self.state / 'apt-daily-upgrade.service.busy').write_text(busy + '\n')
                self.environment.update(FAKE_SYSTEMCTL_FAIL=fail, FAKE_SHOW_DELAY=delay)
                result = subprocess.run(['bash', '-c', 'set -euo pipefail\n' + short], env=self.environment,
                                        capture_output=True, text=True, timeout=60)
                self.assertNotEqual(result.returncode, 0)

    def userdata_update(self, budget):
        userdata, _ = self.userdata_drain()
        update = userdata[userdata.index('# apt-update: begin\n'):userdata.index('# apt-update: end\n')]
        self.assertIn('update_deadline=$((SECONDS + 900))', update)
        return update.replace('update_deadline=$((SECONDS + 900))', 'update_deadline=$((SECONDS + %d))' % budget)

    def bootstrap_update(self, budget):
        return (section().replace('/etc/', str(self.root) + '/etc/')
                .replace('apt_update_seconds=900', 'apt_update_seconds=%d' % budget) + 'apt_update\n')

    def run_update(self, script, mode):
        (self.state / 'apt-calls').unlink(missing_ok=True)
        self.environment['FAKE_APT'] = mode
        result = subprocess.run(['bash', '-c', 'set -euo pipefail\n' + script], env=self.environment,
                                capture_output=True, text=True, timeout=60)
        calls = int((self.state / 'apt-calls').read_text()) if (self.state / 'apt-calls').exists() else 0
        return result, calls

    def test_apt_update_retries_only_lock_contention_within_its_budget(self):
        self.assertIn('apt_update_seconds=900', section())
        for name, stage in (('bootstrap', self.bootstrap_update), ('userdata', self.userdata_update)):
            with self.subTest(stage=name):
                # A generous budget, so only the retry rule decides these.
                result, calls = self.run_update(stage(60), 'lock:2')
                self.assertEqual((result.returncode, calls), (0, 3), result.stderr)
                result, calls = self.run_update(stage(60), 'fail')
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(calls, 1)
                # A lock that is never released fails within the budget.
                result, calls = self.run_update(stage(2), 'lock:1000000')
                self.assertNotEqual(result.returncode, 0)
                self.assertGreater(calls, 1)

    def test_slow_manager_calls_cannot_overrun_the_drain_budget(self):
        # Two idle lookups of 1.5 s each against a 2 s budget must fail, not
        # report success after the budget.
        self.environment['FAKE_SHOW_DELAY'] = '1.5'
        script = ('set -euo pipefail\n' + section().replace('/etc/', str(self.root) + '/etc/').replace(
            'apt_drain_seconds=1500', 'apt_drain_seconds=2') + 'drain_apt_maintenance\n')
        result = subprocess.run(['bash', '-c', script], env=self.environment, capture_output=True,
                                text=True, timeout=60)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('apt maintenance still running after 2s', result.stderr)
        # One lookup slower than the whole budget is cut off at the budget.
        self.environment['FAKE_SHOW_DELAY'] = '6'
        began = time.monotonic()
        result = subprocess.run(['bash', '-c', script], env=self.environment, capture_output=True,
                                text=True, timeout=60)
        self.assertNotEqual(result.returncode, 0)
        self.assertLess(time.monotonic() - began, 5)

    def test_every_apt_call_waits_for_the_package_lock(self):
        userdata, _ = self.userdata_drain()
        for name, text in (('bootstrap.sh', BOOTSTRAP), ('userdata', userdata)):
            calls = [line for line in text.splitlines() if 'timeout' in line and 'apt-get ' in line]
            with self.subTest(name=name):
                self.assertEqual(len(calls), 2)
                for line in calls:
                    self.assertIn('apt-get -o DPkg::Lock::Timeout=600 ', line)

    def test_bootstrap_disables_maintenance_before_apt_and_verifies_before_ready(self):
        body = BOOTSTRAP[BOOTSTRAP.index('# os-maintenance: end\n'):]
        self.assertLess(body.index('\ndisable_os_maintenance\n'), body.index('apt-get '))
        self.assertLess(body.index('\nverify_os_maintenance\n'), body.index('# publish-readiness: begin'))
        self.assertGreater(body.index('\nverify_os_maintenance\n'), body.index(' install -y'))


if __name__ == '__main__':
    unittest.main()
