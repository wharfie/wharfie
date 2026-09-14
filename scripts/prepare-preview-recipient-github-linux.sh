#!/usr/bin/env bash
set -euo pipefail
umask 077

# This account is confined to one disposable GitHub-hosted Linux x64 runner.
[[ "${GITHUB_ACTIONS:-}" == "true" ]] || exit 1
[[ "${RUNNER_ENVIRONMENT:-}" == "github-hosted" ]] || exit 1
[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || exit 1
[[ "$(id -u)" -gt 0 ]] || exit 1
[[ "${GITHUB_RUN_ID:-}" =~ ^[1-9][0-9]{0,19}$ ]] || exit 1
[[ "${GITHUB_RUN_ATTEMPT:-}" =~ ^[1-9][0-9]{0,9}$ ]] || exit 1
sudo -n true

if [[ "$#" -eq 2 && "$1" == "--cleanup" ]]; then
  cleanup_report="$2"
  [[ "${cleanup_report}" == /* && ! -e "${cleanup_report}" && ! -L "${cleanup_report}" ]] || exit 1
  if report="$(sudo -n /usr/bin/python3 - "$(id -u)" "${GITHUB_RUN_ID}" "${GITHUB_RUN_ATTEMPT}" <<'PY'
import json
from pathlib import Path
import pwd
import shutil
import stat
import subprocess
import sys

uid = 60707
name = 'wharfie-recipient'
home = Path('/home/wharfie-recipient')
marker = Path('/var/tmp/wharfie-preview-recipient-owner.json')
linger = Path('/var/lib/systemd/linger/wharfie-recipient')
runtime = Path('/run/user/60707')
socket_root = Path('/tmp/wharfie-60707')
expected = {
    'schemaVersion': 1,
    'kind': 'wharfie.preview-recipient.account-owner',
    'uid': uid,
    'runnerUid': int(sys.argv[1]),
    'githubRunId': sys.argv[2],
    'githubRunAttempt': sys.argv[3],
}
report = {
    'schemaVersion': 1,
    'kind': 'wharfie.preview-recipient.account-cleanup',
    'githubRunId': sys.argv[2],
    'githubRunAttempt': sys.argv[3],
    'accountAbsent': False,
    'homeAbsent': False,
    'userManagerInactive': False,
    'runtimeAbsent': False,
    'socketRootAbsent': False,
    'lingerAbsent': False,
    'markerAbsent': False,
    'status': 'failed',
    'failedStage': 'validate-ownership',
}

def account(key):
    try:
        return pwd.getpwuid(key) if isinstance(key, int) else pwd.getpwnam(key)
    except KeyError:
        return None

def absent(value):
    return not value.exists() and not value.is_symlink()

def run(*args, required=True):
    completed = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30, check=False, text=True)
    if required:
        assert completed.returncode == 0
    return completed

try:
    owned = not absent(marker)
    if owned:
        info = marker.lstat()
        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 1024
        assert json.loads(marker.read_text()) == expected
        by_name = account(name)
        by_uid = account(uid)
        assert by_name is None or (by_name.pw_uid == uid and by_name.pw_dir == str(home))
        assert by_uid is None or by_uid.pw_name == name
        report['failedStage'] = 'terminate-account'
        run('/usr/bin/loginctl', 'terminate-user', str(uid), required=False)
        run('/usr/bin/systemctl', 'stop', 'user@60707.service', 'user-runtime-dir@60707.service')
        if by_name is not None:
            run('/usr/bin/loginctl', 'disable-linger', name)
            report['failedStage'] = 'remove-account'
            run('/usr/sbin/userdel', '--remove', name)
        if not absent(linger):
            assert linger.is_file() and not linger.is_symlink()
            linger.unlink()
        if not absent(home):
            assert home.is_dir() and not home.is_symlink() and home.stat().st_uid in (0, uid)
            shutil.rmtree(home)
        if not absent(socket_root):
            report['failedStage'] = 'remove-socket-root'
            socket_info = socket_root.lstat()
            assert stat.S_ISDIR(socket_info.st_mode) and socket_info.st_uid == uid
            assert shutil.rmtree.avoids_symlink_attacks
            shutil.rmtree(socket_root)
    report['failedStage'] = 'verify-absence'
    report['accountAbsent'] = account(name) is None and account(uid) is None
    report['homeAbsent'] = absent(home)
    report['runtimeAbsent'] = absent(runtime)
    report['socketRootAbsent'] = absent(socket_root)
    report['lingerAbsent'] = absent(linger)
    manager = run('/usr/bin/systemctl', 'show', 'user@60707.service', '--property=ActiveState', '--value')
    report['userManagerInactive'] = manager.stdout.strip() in ('inactive', 'failed')
    assert all(report[key] for key in ('accountAbsent', 'homeAbsent', 'runtimeAbsent', 'socketRootAbsent', 'lingerAbsent', 'userManagerInactive'))
    if owned:
        marker.unlink()
    report['markerAbsent'] = absent(marker)
    assert report['markerAbsent']
    report['status'] = 'passed'
    report['failedStage'] = None
except Exception:
    pass
print(json.dumps(report, sort_keys=True))
sys.exit(0 if report['status'] == 'passed' else 1)
PY
  )"; then
    cleanup_status=0
  else
    cleanup_status=$?
  fi
  (set -o noclobber; printf '%s\n' "${report}" > "${cleanup_report}")
  exit "${cleanup_status}"
fi

[[ "$#" -eq 0 ]] || exit 1
[[ ! -e /home/wharfie-recipient && ! -L /home/wharfie-recipient ]] || exit 1
[[ ! -e /tmp/wharfie-60707 && ! -L /tmp/wharfie-60707 ]] || exit 1
[[ ! -e /var/lib/systemd/linger/wharfie-recipient && ! -L /var/lib/systemd/linger/wharfie-recipient ]] || exit 1
if getent passwd wharfie-recipient >/dev/null || getent passwd 60707 >/dev/null; then
  echo "The disposable recipient account or UID already exists; refusing to reuse it." >&2
  exit 1
fi
[[ "$(sudo -n /usr/bin/systemctl show user@60707.service --property=ActiveState --value)" == "inactive" ]] || exit 1
sudo -n /usr/bin/python3 - "$(id -u)" "${GITHUB_RUN_ID}" "${GITHUB_RUN_ATTEMPT}" <<'PY'
import json
import os
import sys

marker = '/var/tmp/wharfie-preview-recipient-owner.json'
value = {
    'schemaVersion': 1,
    'kind': 'wharfie.preview-recipient.account-owner',
    'uid': 60707,
    'runnerUid': int(sys.argv[1]),
    'githubRunId': sys.argv[2],
    'githubRunAttempt': sys.argv[3],
}
fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as stream:
    stream.write(json.dumps(value, sort_keys=True) + '\n')
    stream.flush()
    os.fsync(stream.fileno())
PY

# PAM must not give the new user the runner's per-user storage paths. Match the
# existing remote-recovery preparation without sourcing /etc/environment.
sudo -n /usr/bin/python3 - "$(id -u)" <<'PY'
from pathlib import Path
import pwd
import re
import sys

runner = pwd.getpwuid(int(sys.argv[1]))
environment = Path('/etc/environment')
assert not environment.is_symlink() and environment.stat().st_size <= 262144
lines = environment.read_text().splitlines(keepends=True)
retained = []
for line in lines:
    match = re.fullmatch(r'\s*(?:export\s+)?(XDG_(?:CONFIG_HOME|CACHE_HOME|DATA_HOME|STATE_HOME|RUNTIME_DIR))\s*=\s*(.*?)\s*', line)
    value = match[2].strip('\'"') if match else ''
    runner_path = value == runner.pw_dir or value.startswith(runner.pw_dir + '/')
    home_reference = value.startswith(('$HOME/', '${HOME}/'))
    runtime_path = value == '/run/user/' + str(runner.pw_uid)
    if match and (runner_path or home_reference or runtime_path):
        continue
    retained.append(line)
environment.write_text(''.join(retained))
PY

sudo -n /usr/sbin/useradd --uid 60707 --create-home --shell /usr/sbin/nologin wharfie-recipient
sudo -n /usr/bin/chmod 0700 /home/wharfie-recipient
sudo -n /usr/bin/install -d -m 0700 -o wharfie-recipient -g wharfie-recipient \
  /home/wharfie-recipient/recipient \
  /home/wharfie-recipient/recipient/bin \
  /home/wharfie-recipient/recipient/tmp
for command in systemctl loginctl; do
  [[ -x "/usr/bin/${command}" ]] || exit 1
  sudo -n /usr/bin/ln -s "/usr/bin/${command}" "/home/wharfie-recipient/recipient/bin/${command}"
done
sudo -n /usr/bin/loginctl enable-linger wharfie-recipient
sudo -n /usr/bin/systemctl start user@60707.service

recipient() {
  sudo -n -u wharfie-recipient /usr/bin/env -i \
    HOME=/home/wharfie-recipient USER=wharfie-recipient LOGNAME=wharfie-recipient \
    PATH=/home/wharfie-recipient/recipient/bin \
    TMPDIR=/home/wharfie-recipient/recipient/tmp \
    XDG_CONFIG_HOME=/home/wharfie-recipient/.config \
    XDG_CACHE_HOME=/home/wharfie-recipient/.cache \
    XDG_DATA_HOME=/home/wharfie-recipient/.local/share \
    XDG_STATE_HOME=/home/wharfie-recipient/.local/state \
    XDG_RUNTIME_DIR=/run/user/60707 \
    DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/60707/bus \
    "$@"
}

# The resident inherits its user manager's environment, so confine its PATH as
# well as every submitting command. Node still exists for the separate builder.
recipient /usr/bin/systemctl --user set-environment \
  HOME=/home/wharfie-recipient \
  PATH=/home/wharfie-recipient/recipient/bin \
  TMPDIR=/home/wharfie-recipient/recipient/tmp \
  XDG_CONFIG_HOME=/home/wharfie-recipient/.config \
  XDG_CACHE_HOME=/home/wharfie-recipient/.cache \
  XDG_DATA_HOME=/home/wharfie-recipient/.local/share \
  XDG_STATE_HOME=/home/wharfie-recipient/.local/state \
  XDG_RUNTIME_DIR=/run/user/60707
recipient /usr/bin/systemctl --user show-environment >/dev/null
for command in node npm; do
  if recipient /usr/bin/env "${command}" --version >/dev/null 2>&1; then
    echo "The recipient PATH unexpectedly exposes ${command}." >&2
    exit 1
  else
    status=$?
    [[ "${status}" -eq 127 ]] || exit 1
  fi
done
