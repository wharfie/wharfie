#!/bin/bash
set -euo pipefail
umask 022
export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C.UTF-8
# readiness: begin
# No earlier attempt's readiness survives this one, including the old receipt
# in the service user's home. A fresh receipt is published only after every
# check below, in root-owned /etc/wharfie-soak.
rm -f /var/lib/wharfie-soak/bootstrap-ready.json /etc/wharfie-soak/bootstrap-ready.json \
  /etc/wharfie-soak/bootstrap-ready.json.tmp
# readiness: end
# The acceptance harness is the candidate's own commit. The operations bundle,
# identified by its hashes and the recorded controller commit, may be newer.
harness_commit=$(python3 -c 'import json,re; c=json.load(open("/etc/wharfie-soak/campaign.json"))["sourceCommit"]; assert re.fullmatch("[0-9a-f]{40}",c); print(c)')

# os-maintenance: begin
# OS maintenance must not restart the supervisor during a campaign. On
# 2026-11-27 apt-daily-upgrade ran unattended-upgrade, and needrestart then
# restarted wharfie-soak.service, which stopped both full soaks (see README).
apt_timers='apt-daily.timer apt-daily-upgrade.timer'
apt_services='apt-daily.service apt-daily-upgrade.service'
apt_maintenance_units="$apt_timers $apt_services"
# Longest wait for an apt run already in progress; dpkg is never killed.
apt_drain_seconds=1500
needrestart_conf=/etc/needrestart/needrestart.conf
needrestart_dropin=/etc/needrestart/conf.d/wharfie-soak.conf
# needrestart matches each override_rc regex against the unit name.
needrestart_override='$nrconf{override_rc}->{qr(^wharfie-soak\.service$)} = 0;'

# Print "LoadState ActiveState UnitFileState"; fail when systemd cannot answer.
unit_states() {
  local output line load='' active='' file=''
  output=$(timeout "${systemctl_seconds:-30}" systemctl show --property=LoadState \
    --property=ActiveState --property=UnitFileState -- "$1") || return 1
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

# Wait until neither daily service runs. A oneshot upgrade is "activating"
# while it works, so only inactive or failed counts as finished. Stopping the
# service would not join it: with KillMode=process its upgrade can outlive it.
drain_apt_maintenance() {
  local deadline=$((SECONDS + apt_drain_seconds)) unit states busy left
  while :; do
    busy=
    for unit in $apt_services; do
      # Every manager call is limited to the time that remains.
      left=$((deadline - SECONDS))
      if [ "$left" -le 0 ] || ! states=$(systemctl_seconds=$left unit_states "$unit"); then
        busy=$unit
        continue
      fi
      case ${states#* } in
        inactive\ *|failed\ *) ;;
        *) busy=$unit ;;
      esac
    done
    [ -z "$busy" ] && return 0
    left=$((deadline - SECONDS))
    if [ "$left" -le 0 ]; then
      maintenance_failure "apt maintenance still running after ${apt_drain_seconds}s: $busy"
    fi
    sleep $((left < 10 ? left : 10))
  done
}

# `apt-get update` does not wait for the lists lock (Noble apt 2.8), so it is
# retried while its error names a held lock, within a fixed budget.
apt_update_seconds=900
apt_update() {
  local deadline=$((SECONDS + apt_update_seconds)) output left
  while :; do
    left=$((deadline - SECONDS))
    if [ "$left" -le 0 ]; then
      maintenance_failure "apt-get update still locked after ${apt_update_seconds}s"
    fi
    if output=$(timeout "$left" apt-get -o DPkg::Lock::Timeout=600 update -q 2>&1); then
      printf '%s\n' "$output"
      return 0
    fi
    printf '%s\n' "$output" >&2
    case $output in
      *'Could not get lock'*) sleep 15 ;;
      *) maintenance_failure 'apt-get update failed' ;;
    esac
  done
}

disable_os_maintenance() {
  install -d -m 0755 "$(dirname "$needrestart_dropin")"
  printf '%s\n' "$needrestart_override" > "$needrestart_dropin"
  chmod 0644 "$needrestart_dropin"
  # No new timer activation, then let any run already started finish.
  timeout 120 systemctl stop $apt_timers
  drain_apt_maintenance
  systemctl mask $apt_maintenance_units
  if systemctl list-unit-files unattended-upgrades.service --no-legend 2>/dev/null | \
      awk '{print $1}' | grep -qx unattended-upgrades.service; then
    timeout 600 systemctl disable --now unattended-upgrades.service
  fi
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
  if ! printf '%s\n' "$needrestart_override" | cmp -s - "$needrestart_dropin"; then
    maintenance_failure "needrestart override is not exact: $needrestart_dropin"
  fi
  # Only a configuration we can evaluate exactly is supported: the packaged
  # main file, unmodified, and in conf.d only unmodified packaged files plus
  # our drop-in. Anything else fails bootstrap (see README).
  if ! python3 - "$needrestart_conf" "$needrestart_dropin" <<'CONFFILES'
import hashlib, os, subprocess, sys
main, dropin = sys.argv[1:3]
listing = subprocess.run(['dpkg-query', '-W', '-f=${Conffiles}\n', 'needrestart'], check=True,
                         capture_output=True, text=True, timeout=60).stdout
# " <path> <md5>"; obsolete or remove-on-upgrade entries carry a third field.
packaged = {fields[0]: fields[1] for fields in map(str.split, listing.splitlines()) if len(fields) == 2}
def md5(path):
    with open(path, 'rb') as source:
        return hashlib.md5(source.read()).hexdigest()
if packaged.get(main) != md5(main):
    sys.exit('needrestart.conf differs from the packaged file')
directory = os.path.dirname(dropin)
for name in sorted(os.listdir(directory)):
    path = os.path.join(directory, name)
    if path != dropin and packaged.get(path) != md5(path):
        sys.exit('needrestart snippet is not an unmodified packaged file: ' + name)
CONFFILES
  then
    maintenance_failure 'needrestart configuration is not the packaged set plus the override'
  fi
  # Positive control: load that exact set as the apt hook does (`needrestart
  # -m u`, NEEDRESTART_MODE=a, has_pam_systemd set on Noble). Every
  # override_rc regex that matches the unit must deny the restart; Perl hash
  # order is not precedence.
  if ! perl - "$needrestart_conf" <<'PERL'
our (%nrconf, $opt_m, $opt_r);
my $file = shift;
my $config = do { local $/; open my $handle, '<', $file or die; <$handle> };
$opt_m = 'u';
$ENV{NEEDRESTART_MODE} = 'a';
%nrconf = (override_rc => {}, override_cont => {}, blacklist_rc => [], restart => 'i', has_pam_systemd => 1);
eval $config;
die $@ if $@;
my @matches = grep { 'wharfie-soak.service' =~ /$_/ } keys %{$nrconf{override_rc}};
exit((@matches && !grep { $nrconf{override_rc}{$_} } @matches) ? 0 : 1);
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
# The drain above leaves no daily run; any other lock holder is waited for.
apt_update
timeout 1500 apt-get -o DPkg::Lock::Timeout=600 install -y --no-install-recommends \
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
# harness: begin
# Record or verify the harness tree without git: tracked paths, their kind
# (file, executable, symlink) and SHA-256. Only node_modules/ may be added.
harness_manifest() {
  python3 - "$@" <<'MANIFEST'
import hashlib, json, os, stat, subprocess, sys
action, root, manifest = sys.argv[1:4]
GENERATED = 'node_modules'

def describe(path):
    info = os.lstat(path)
    if stat.S_ISLNK(info.st_mode):
        return ['link', hashlib.sha256(os.fsencode(os.readlink(path))).hexdigest()]
    if not stat.S_ISREG(info.st_mode):
        return ['other', '']
    # One no-follow, non-blocking descriptor, so the bytes hashed belong to
    # the regular file checked. A hard link could share them with a path the
    # installer still controls, so a tracked file has exactly one link.
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        opened = os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1:
            return ['other', '']
        digest = hashlib.sha256()
        for chunk in iter(lambda: os.read(descriptor, 1048576), b''):
            digest.update(chunk)
    finally:
        os.close(descriptor)
    return ['exec' if opened.st_mode & 0o111 else 'file', digest.hexdigest()]

if action == 'record':
    # Root runs git once, on its own fresh clone, before the installer owns anything.
    listing = subprocess.run(['git', '-C', root, 'ls-files', '-s', '-z'], check=True,
                             capture_output=True, timeout=300).stdout
    kinds = {b'100644': 'file', b'100755': 'exec', b'120000': 'link'}
    files = {}
    for entry in filter(None, listing.split(b'\0')):
        meta, name = entry.split(b'\t', 1)
        name = name.decode()
        actual = describe(os.path.join(root, name))
        if actual[0] != kinds.get(meta.split()[0]):
            sys.exit('harness entry does not match its commit: ' + name)
        files[name] = actual
    with open(manifest, 'x') as output:
        json.dump(files, output)
    sys.exit(0)

with open(manifest) as source:
    files = json.load(source)
directories = {os.path.dirname(name) for name in files}
for name in list(directories):
    while name:
        name = os.path.dirname(name)
        directories.add(name)
seen = set()
for base, dirnames, filenames in os.walk(root):
    relative = os.path.relpath(base, root)
    relative = '' if relative == '.' else relative
    for name in list(dirnames):
        path = os.path.join(relative, name)
        if os.path.islink(os.path.join(base, name)):
            filenames.append(name)
            dirnames.remove(name)
        elif path == GENERATED:
            dirnames.remove(name)
        elif path not in directories:
            sys.exit('harness directory added during npm ci: ' + path)
    for name in filenames:
        path = os.path.join(relative, name)
        if path not in files:
            sys.exit('harness file added during npm ci: ' + path)
        if describe(os.path.join(base, name)) != files[path]:
            sys.exit('harness file changed during npm ci: ' + path)
        seen.add(path)
missing = sorted(set(files) - seen)
if missing:
    sys.exit('harness file removed during npm ci: ' + missing[0])
MANIFEST
}

# Every attempt installs a fresh disposable checkout, so no edit, file or
# ownership left by an earlier attempt can reach the installed harness.
rm -rf /opt/wharfie-soak/harness /opt/wharfie-soak/harness-manifest.json
timeout 300 git clone --no-checkout --filter=blob:none \
  https://github.com/wharfie/wharfie.git /opt/wharfie-soak/harness
timeout 300 git -C /opt/wharfie-soak/harness fetch --depth=1 origin \
  "$harness_commit"
git -C /opt/wharfie-soak/harness checkout --detach \
  "$harness_commit"
[ "$(git -C /opt/wharfie-soak/harness rev-parse HEAD)" = "$harness_commit" ]
# The manifest lives outside the checkout, in root-owned /opt/wharfie-soak.
# The git metadata is removed before the installer owns the tree, so no
# privileged git ever reads anything the installer could write.
harness_manifest record /opt/wharfie-soak/harness /opt/wharfie-soak/harness-manifest.json
rm -rf /opt/wharfie-soak/harness/.git
chown -R wharfie-soak:wharfie-soak /opt/wharfie-soak/harness
cd /opt/wharfie-soak/harness
timeout 1200 /usr/sbin/runuser -u wharfie-soak -- env -i \
  HOME=/var/lib/wharfie-soak PATH="$PATH" LANG=C.UTF-8 \
  AWS_EC2_METADATA_DISABLED=true npm ci --no-audit --no-fund
cd /
chown -R root:root /opt/wharfie-soak/harness
chmod -R a+rX,go-w /opt/wharfie-soak/harness
harness_manifest verify /opt/wharfie-soak/harness /opt/wharfie-soak/harness-manifest.json
# harness: end
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
# publish-readiness: begin
python3 - <<'PY'
import json, os, stat, time
directory = '/etc/wharfie-soak'
info = os.lstat(directory)
# Root-only: a directory no other user can write, and no path to follow.
assert stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
with open(directory + '/campaign.json') as source:
    spec = json.load(source)['specSha256']
data = json.dumps({'ready': True, 'at': time.time(), 'specSha256': spec,
                   'node': '24.13.1', 'npm': '11.12.0'}).encode()
temporary = directory + '/bootstrap-ready.json.tmp'
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
try:
    os.write(descriptor, data)
    os.fsync(descriptor)
finally:
    os.close(descriptor)
os.replace(temporary, directory + '/bootstrap-ready.json')
descriptor = os.open(directory, os.O_RDONLY)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
# publish-readiness: end
