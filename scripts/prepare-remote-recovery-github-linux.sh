#!/usr/bin/env bash
set -euo pipefail
umask 077

# This setup is only for the disposable native x64 GitHub-hosted proof lane.
# Lima provisions the same account through its pinned VM config.
[[ "${GITHUB_ACTIONS:-}" == "true" ]]
[[ "${RUNNER_ENVIRONMENT:-}" == "github-hosted" ]]
[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]]
[[ "$(id -u)" -gt 0 ]]
[[ ! -e /var/tmp/wharfie-systemd-proof && ! -L /var/tmp/wharfie-systemd-proof ]]
[[ ! -e /etc/wharfie && ! -L /etc/wharfie ]]
[[ ! -e /var/lib/wharfie-bootstrap-v1.complete && ! -L /var/lib/wharfie-bootstrap-v1.complete ]]
[[ ! -e /home/wharfie && ! -L /home/wharfie ]]
if getent passwd wharfie >/dev/null || getent passwd 60706 >/dev/null; then
  echo "The disposable proof account or UID already exists; refusing to reuse it." >&2
  exit 1
fi
sudo -n true
# GitHub images put runner-specific XDG paths in /etc/environment, which PAM
# then applies to secondary users (runner-images#13049 and #14649). Remove only
# these per-user paths on this guarded disposable runner; never source the file.
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
sudo -n apt-get update -qq
sudo -n apt-get install -y --no-install-recommends openssh-server
sudo -n useradd --uid 60706 --create-home --shell /bin/bash wharfie
sudo -n passwd --delete wharfie
sudo -n loginctl enable-linger "$(id -un)"
sudo -n loginctl enable-linger wharfie
sudo -n systemctl start "user@$(id -u).service" user@60706.service
sudo -n install -d -m 0700 -o wharfie -g wharfie /home/wharfie/.ssh
sudo -n install -d -m 0700 -o wharfie -g wharfie /home/wharfie/.local/share/wharfie-nodejs
sudo -n install -d -m 0755 /etc/wharfie
sudo -n systemctl start ssh.service
# Exercise a login/PAM environment without printing any environment contents.
sudo -n -i -u wharfie /usr/bin/python3 -c '
import os
assert os.getuid() == 60706
for name, expected in {
    "XDG_CONFIG_HOME": "/home/wharfie/.config",
    "XDG_CACHE_HOME": "/home/wharfie/.cache",
    "XDG_DATA_HOME": "/home/wharfie/.local/share",
    "XDG_STATE_HOME": "/home/wharfie/.local/state",
    "XDG_RUNTIME_DIR": "/run/user/60706",
}.items():
    assert os.environ.get(name) in (None, "", expected), name + " has a foreign user path"
'
sudo -n -u wharfie /usr/bin/env -i \
  HOME=/home/wharfie USER=wharfie LOGNAME=wharfie PATH=/usr/bin:/bin \
  XDG_RUNTIME_DIR=/run/user/60706 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/60706/bus \
  /usr/bin/systemctl --user show-environment >/dev/null
