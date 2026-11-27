#!/bin/bash
set -euo pipefail
umask 022
export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C.UTF-8
# The acceptance harness is the candidate's own commit. The operations bundle,
# identified by its hashes and the recorded controller commit, may be newer.
harness_commit=$(python3 -c 'import json,re; c=json.load(open("/etc/wharfie-soak/campaign.json"))["sourceCommit"]; assert re.fullmatch("[0-9a-f]{40}",c); print(c)')

# os-maintenance: begin
# OS maintenance must not restart the supervisor during a campaign. On
# 2026-11-27 apt-daily-upgrade ran unattended-upgrade, and needrestart then
# restarted wharfie-soak.service, which stopped both full soaks (see README).
apt_maintenance_units='apt-daily.timer apt-daily-upgrade.timer apt-daily.service apt-daily-upgrade.service'
needrestart_conf=/etc/needrestart/needrestart.conf
needrestart_dropin=/etc/needrestart/conf.d/wharfie-soak.conf
# needrestart matches each override_rc regex against the unit name.
needrestart_override='$nrconf{override_rc}->{qr(^wharfie-soak\.service$)} = 0;'

disable_os_maintenance() {
  install -d -m 0755 "$(dirname "$needrestart_dropin")"
  printf '%s\n' "$needrestart_override" > "$needrestart_dropin"
  chmod 0644 "$needrestart_dropin"
  # Stopping the services waits for an upgrade already in progress.
  timeout 1200 systemctl stop $apt_maintenance_units
  systemctl mask $apt_maintenance_units
  if systemctl list-unit-files unattended-upgrades.service --no-legend 2>/dev/null | \
      awk '{print $1}' | grep -qx unattended-upgrades.service; then
    timeout 600 systemctl disable --now unattended-upgrades.service
  fi
}

# Print "LoadState ActiveState UnitFileState"; fail when systemd cannot answer.
unit_states() {
  local output line load='' active='' file=''
  output=$(systemctl show --property=LoadState --property=ActiveState --property=UnitFileState -- "$1") || return 1
  while IFS= read -r line; do
    case $line in
      LoadState=*) load=${line#LoadState=} ;;
      ActiveState=*) active=${line#ActiveState=} ;;
      UnitFileState=*) file=${line#UnitFileState=} ;;
    esac
  done <<< "$output"
  [ -n "$load" ] && [ -n "$active" ] || return 1
  printf '%s %s %s\n' "$load" "$active" "${file:--}"
}

maintenance_failure() {
  echo "$1" >&2
  exit 1
}

verify_os_maintenance() {
  local unit states
  # Only these exact states pass; any other state or a lookup failure refuses.
  for unit in $apt_maintenance_units; do
    states=$(unit_states "$unit") || maintenance_failure "OS maintenance unit state unavailable: $unit"
    case $states in
      'masked inactive masked'|'masked failed masked') ;;
      *) maintenance_failure "OS maintenance unit is not masked and inactive: $unit ($states)" ;;
    esac
  done
  states=$(unit_states unattended-upgrades.service) || \
    maintenance_failure 'OS maintenance unit state unavailable: unattended-upgrades.service'
  case $states in
    # An image without the unit is supported; an unreadable unit is not.
    'not-found inactive -'|'loaded inactive disabled'|'loaded inactive masked'|'masked inactive masked') ;;
    *) maintenance_failure "unattended-upgrades.service is not disabled ($states)" ;;
  esac
  [ -f "$needrestart_conf" ] && [ -r "$needrestart_conf" ] || \
    maintenance_failure "needrestart configuration is not readable: $needrestart_conf"
  if ! printf '%s\n' "$needrestart_override" | cmp -s - "$needrestart_dropin"; then
    maintenance_failure "needrestart override is not exact: $needrestart_dropin"
  fi
  # Evaluate the configuration as needrestart loads it: every override_rc
  # regex that matches the unit must deny the restart. The apt hook runs
  # `needrestart -m u`; other callers differ. A snippet that branches on these
  # loader variables is evaluated in every combination of them; snippets that
  # branch on anything else are unsupported (see README).
  if ! perl - "$needrestart_conf" <<'PERL'
our (%nrconf, $opt_m, $opt_r, $opt_b, $is_tty, $has_pam_systemd);
my $file = shift;
my $config = do { local $/; open my $handle, '<', $file or die; <$handle> };
for my $m ('u', 'a', 'e') { for my $r (undef, 'a', 'l', 'i') { for my $b (undef, 1) {
for my $tty (0, 1) { for my $pam (0, 1) {
  ($opt_m, $opt_r, $opt_b, $is_tty, $has_pam_systemd) = ($m, $r, $b, $tty, $pam);
  local $ENV{NEEDRESTART_MODE} = $r if defined $r;
  %nrconf = (override_rc => {}, override_cont => {}, blacklist_rc => [], restart => 'i');
  eval $config;
  die $@ if $@;
  my @matches = grep { 'wharfie-soak.service' =~ /$_/ } keys %{$nrconf{override_rc}};
  exit 1 unless @matches && !grep { $nrconf{override_rc}{$_} } @matches;
} } } } }
exit 0;
PERL
  then
    maintenance_failure 'needrestart may still restart wharfie-soak.service'
  fi
}
# os-maintenance: end

disable_os_maintenance

for attempt in $(seq 1 60); do
  if timeout 10 curl --proto '=https' --tlsv1.2 -fsS --connect-timeout 5 --max-time 8 \
      https://nodejs.org/dist/v24.13.1/SHASUMS256.txt >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" = 60 ]; then exit 1; fi
  sleep 5
done
timeout 600 apt-get update -q
timeout 900 apt-get install -y --no-install-recommends \
  ca-certificates curl git xz-utils openssh-client python3 python3-boto3 \
  build-essential pkg-config libssl-dev
if ! id wharfie-soak >/dev/null 2>&1; then
  useradd --uid 60710 --create-home --home-dir /var/lib/wharfie-soak \
    --shell /usr/sbin/nologin wharfie-soak
fi
[ "$(id -u wharfie-soak)" = 60710 ]
install -d -m 0700 -o wharfie-soak -g wharfie-soak \
  /var/lib/wharfie-soak /var/lib/wharfie-soak/runs /var/lib/wharfie-soak/homes \
  /var/lib/wharfie-soak/homes/aws /var/lib/wharfie-soak/homes/hetzner
install -d -m 0755 /opt/wharfie-soak /opt/wharfie-soak/ops \
  /opt/wharfie-soak/node /opt/wharfie-soak/candidate /etc/wharfie-soak
stage=$(mktemp -d /var/tmp/wharfie-soak-bootstrap.XXXXXXXX)
trap 'rm -rf "$stage"' EXIT
timeout 300 curl --proto '=https' --tlsv1.2 -fsS --location --max-time 290 \
  https://nodejs.org/dist/v24.13.1/node-v24.13.1-linux-x64.tar.xz \
  --output "$stage/node.tar.xz"
printf '%s  %s\n' \
  30215f90ea3cd04dfbc06e762c021393fa173a1d392974298bbc871a8e461089 \
  "$stage/node.tar.xz" | sha256sum --check --status
tar -xJf "$stage/node.tar.xz" --no-same-owner --strip-components=1 -C /opt/wharfie-soak/node
export PATH=/opt/wharfie-soak/node/bin:/usr/bin:/bin
[ "$(node --version)" = v24.13.1 ]
timeout 600 npm install --global --ignore-scripts --no-audit --no-fund \
  --registry=https://registry.npmjs.org npm@11.12.0
[ "$(npm --version)" = 11.12.0 ]
chown -R root:root /opt/wharfie-soak/node
chmod -R a+rX,go-w /opt/wharfie-soak/node
if [ ! -d /opt/wharfie-soak/harness/.git ]; then
  timeout 300 git clone --no-checkout --filter=blob:none \
    https://github.com/wharfie/wharfie.git /opt/wharfie-soak/harness
else
  # A previous install attempt may have left this checkout owned by the service.
  chown -R root:root /opt/wharfie-soak/harness
fi
timeout 300 git -C /opt/wharfie-soak/harness fetch --depth=1 origin \
  "$harness_commit"
git -C /opt/wharfie-soak/harness checkout --detach \
  "$harness_commit"
[ "$(git -C /opt/wharfie-soak/harness rev-parse HEAD)" = "$harness_commit" ]
chown -R wharfie-soak:wharfie-soak /opt/wharfie-soak/harness
cd /opt/wharfie-soak/harness
timeout 1200 /usr/sbin/runuser -u wharfie-soak -- env -i \
  HOME=/var/lib/wharfie-soak PATH="$PATH" LANG=C.UTF-8 \
  AWS_EC2_METADATA_DISABLED=true npm ci --no-audit --no-fund
chown -R root:root /opt/wharfie-soak/harness
chmod -R a+rX,go-w /opt/wharfie-soak/harness
timeout 900 python3 /opt/wharfie-soak/ops/download_candidate.py
timeout 180 /usr/sbin/runuser -u wharfie-soak -- env -i \
  HOME=/var/lib/wharfie-soak PATH="$PATH" LANG=C.UTF-8 \
  AWS_EC2_METADATA_DISABLED=true /usr/bin/python3 /opt/wharfie-soak/ops/check_bootstrap.py
install -d -m 0755 /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/wharfie-soak.conf <<'JOURNAL'
[Journal]
Storage=persistent
SystemMaxUse=256M
RuntimeMaxUse=64M
MaxRetentionSec=7day
JOURNAL
systemctl restart systemd-journald
systemctl daemon-reload
if systemctl list-unit-files amazon-ssm-agent.service --no-legend 2>/dev/null | \
    awk '{print $1}' | /usr/bin/grep -qx amazon-ssm-agent.service; then
  systemctl enable --now amazon-ssm-agent.service
else
  snap start amazon-ssm-agent
fi
verify_os_maintenance
python3 - <<'PY'
import json, pathlib, time
p = pathlib.Path('/var/lib/wharfie-soak/bootstrap-ready.json')
p.write_text(json.dumps({'ready': True, 'at': time.time(), 'node': '24.13.1', 'npm': '11.12.0'}))
p.chmod(0o644)
PY
