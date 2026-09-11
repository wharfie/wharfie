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
sudo -n -u wharfie /usr/bin/env -i \
  HOME=/home/wharfie USER=wharfie LOGNAME=wharfie PATH=/usr/bin:/bin \
  XDG_RUNTIME_DIR=/run/user/60706 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/60706/bus \
  /usr/bin/systemctl --user show-environment >/dev/null
