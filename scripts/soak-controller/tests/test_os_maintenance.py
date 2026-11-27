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

FAKE_SYSTEMCTL = r'''#!/bin/bash
state=$FAKE_SYSTEMD
echo "$*" >> "$state/log"
command=$1; shift
case $command in
  stop) for unit in "$@"; do echo inactive > "$state/$unit.active"; done ;;
  mask) for unit in "$@"; do echo masked > "$state/$unit.enabled"; done ;;
  disable)
    [ "$1" = --now ] && shift && for unit in "$@"; do echo inactive > "$state/$unit.active"; done
    for unit in "$@"; do echo disabled > "$state/$unit.enabled"; done ;;
  list-unit-files) [ -e "$state/$1.enabled" ] && echo "$1 $(cat "$state/$1.enabled") enabled" ;;
  is-enabled) value=$(cat "$state/$1.enabled" 2>/dev/null) || exit 1; echo "$value"; [ "$value" = enabled ] ;;
  is-active) value=$(cat "$state/$1.active" 2>/dev/null || echo inactive); echo "$value"; [ "$value" = active ] ;;
  *) exit 2 ;;
esac
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

    def test_verification_fails_when_a_maintenance_unit_is_not_masked_or_is_active(self):
        for unit in UNITS:
            for suffix, value in (('.enabled', 'enabled'), ('.enabled', 'disabled'), ('.active', 'active')):
                with self.subTest(unit=unit, value=suffix + '=' + value):
                    self.disable()
                    (self.state / (unit + suffix)).write_text(value + '\n')
                    self.assert_refused('not masked and inactive: ' + unit)

    def test_verification_fails_when_unattended_upgrades_is_enabled(self):
        self.disable()
        (self.state / 'unattended-upgrades.service.enabled').write_text('enabled\n')
        self.assert_refused('unattended-upgrades.service is not disabled')

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
