#!/usr/bin/env bash
set -euo pipefail
umask 077

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_ROOT="${REPO_ROOT}/llm_artifacts/steady-file-systemd-proof"
BUILDER_CONFIG="${REPO_ROOT}/test/systemd/lima.yaml"
TARGET_CONFIG="${REPO_ROOT}/test/systemd/steady-file-preview-target-lima.yaml"
INSTANCE_BASE="${WHARFIE_STEADY_FILE_PREVIEW_INSTANCE_BASE:-wfp-$$}"
BUILDER_INSTANCE="${INSTANCE_BASE}-b"
TARGET_INSTANCE="${INSTANCE_BASE}-t"
MINIMUM_FREE_KIB=$((15 * 1024 * 1024))
TEMP_PARENT="${TMPDIR:-/tmp}"
TEMP_ROOT="$(mktemp -d "${TEMP_PARENT%/}/wfp.XXXXXX")"
HOST_HOME="${TEMP_ROOT}/home"
LIMA_HOME="${TEMP_ROOT}/lima"
ARCHIVE_PATH="${TEMP_ROOT}/repo.tar"
HOST_HANDOFF_ROOT="${TEMP_ROOT}/handoff"
HOST_INPUT_PATH="${TEMP_ROOT}/artifact.tar"
HOST_BUILDER_RECEIPT="${TEMP_ROOT}/builder.json"
HOST_PREPARE_RECEIPT="${TEMP_ROOT}/prepare.json"
HOST_FINAL_RECEIPT="${TEMP_ROOT}/final.json"
GUEST_BUILDER_ROOT="/var/tmp/wharfie-steady-file-preview-builder"
GUEST_REPO="${GUEST_BUILDER_ROOT}/repo"
GUEST_HANDOFF_ROOT="${GUEST_BUILDER_ROOT}/handoff"
GUEST_BUILDER_RECEIPT="${GUEST_BUILDER_ROOT}/builder.json"
TARGET_ROOT="/home/wharfie/preview"
TARGET_HANDOFF_ROOT="${TARGET_ROOT}/handoff"
TARGET_INPUT_PATH="${TARGET_ROOT}/artifact.tar"
RECEIPT_STAGING=""
COMMIT=""
LIMACTL_BIN=""
NODE_BIN=""
LIMA_TOUCHED=0
CLEANUP_COMPLETE=0

HANDOFF_FILES=(
  "source/app"
  "source/artifact-record.json"
  "target/app"
  "target/artifact-record.json"
  "handoff.json"
  "SHA256SUMS"
)

lima() {
  /usr/bin/env \
    "HOME=${HOST_HOME}" \
    "LIMA_HOME=${LIMA_HOME}" \
    "${LIMACTL_BIN}" "$@"
}

instance_is_listed() {
  local instances
  local candidate
  if ! instances="$(lima list --quiet)"; then
    echo "Failed to inspect isolated Lima instances." >&2
    return 2
  fi
  while IFS= read -r candidate; do
    if [[ "${candidate}" == "$1" ]]; then
      return 0
    fi
  done <<< "${instances}"
  return 1
}

delete_and_assert_absent() {
  local instance="$1"
  local presence_status
  lima delete --force "${instance}"
  if instance_is_listed "${instance}"; then
    echo "Lima instance ${instance} still exists after deletion." >&2
    return 1
  else
    presence_status=$?
    if [[ "${presence_status}" -ne 1 ]]; then
      return 1
    fi
  fi
}

cleanup_instance_if_present() {
  local instance="$1"
  local presence_status
  if instance_is_listed "${instance}"; then
    lima delete --force "${instance}" || return 1
    if instance_is_listed "${instance}"; then
      echo "Lima instance ${instance} survived failure cleanup." >&2
      return 1
    else
      presence_status=$?
      [[ "${presence_status}" -eq 1 ]] || return 1
    fi
  else
    presence_status=$?
    [[ "${presence_status}" -eq 1 ]] || return 1
  fi
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "${CLEANUP_COMPLETE}" -ne 1 && "${LIMA_TOUCHED}" -eq 1 ]]; then
    cleanup_instance_if_present "${TARGET_INSTANCE}" || status=1
    cleanup_instance_if_present "${BUILDER_INSTANCE}" || status=1
  fi
  if [[ -n "${RECEIPT_STAGING}" ]]; then
    rm -rf "${RECEIPT_STAGING}" || status=1
  fi
  rm -rf "${TEMP_ROOT}" || status=1
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The split steady-file preview driver requires macOS." >&2
  exit 1
fi
if ! LIMACTL_BIN="$(command -v limactl)"; then
  echo "limactl is required (Lima 2.1 or newer)." >&2
  exit 1
fi
if ! NODE_BIN="${WHARFIE_STEADY_FILE_PREVIEW_NODE:-$(command -v node)}"; then
  echo "Node 24.13.1 is required on the host." >&2
  exit 1
fi
if [[ ! -x "${NODE_BIN}" || "$("${NODE_BIN}" --version)" != "v24.13.1" ]]; then
  echo "WHARFIE_STEADY_FILE_PREVIEW_NODE must be the exact Node 24.13.1 executable." >&2
  exit 1
fi
if [[ ! "${INSTANCE_BASE}" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]]; then
  echo "WHARFIE_STEADY_FILE_PREVIEW_INSTANCE_BASE is not a safe Lima name." >&2
  exit 1
fi
if [[ "${BUILDER_INSTANCE}" == "${TARGET_INSTANCE}" ]]; then
  echo "Builder and target Lima instances must be distinct." >&2
  exit 1
fi
for instance in "${BUILDER_INSTANCE}" "${TARGET_INSTANCE}"; do
  socket_probe="${LIMA_HOME}/${instance}/ssh.sock.1234567890123456"
  socket_bytes="$(
    /usr/bin/printf '%s' "${socket_probe}" |
      /usr/bin/wc -c |
      /usr/bin/tr -d ' '
  )"
  if [[ ! "${socket_bytes}" =~ ^[0-9]+$ ]] || ((socket_bytes >= 104)); then
    echo "The isolated Lima socket path for ${instance} must be shorter than 104 bytes." >&2
    exit 1
  fi
done

mkdir -p "${HOST_HOME}" "${LIMA_HOME}" "${HOST_HANDOFF_ROOT}/source" \
  "${HOST_HANDOFF_ROOT}/target"

AVAILABLE_KIB="$(/bin/df -Pk "${TEMP_ROOT}" | /usr/bin/awk 'NR == 2 { print $4 }')"
if [[ ! "${AVAILABLE_KIB}" =~ ^[0-9]+$ ]]; then
  echo "Could not determine available disk space for the disposable proof." >&2
  exit 1
fi
if ((AVAILABLE_KIB < MINIMUM_FREE_KIB)); then
  echo "The split preview proof requires at least 15 GiB free before creating or downloading a VM." >&2
  exit 1
fi

WORKTREE_STATUS="$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=all)"
if [[ -n "${WORKTREE_STATUS}" ]]; then
  echo "Commit or remove worktree changes before creating a proof receipt." >&2
  exit 1
fi
COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
if [[ ! "${COMMIT}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "The proof requires an exact Git commit." >&2
  exit 1
fi
RECEIPT_DIRECTORY="${OUTPUT_ROOT}/${COMMIT}"
if [[ -e "${RECEIPT_DIRECTORY}" ]]; then
  echo "Proof receipts already exist for ${COMMIT}; refusing to overwrite them." >&2
  exit 1
fi

LIMA_TOUCHED=1
for instance in "${BUILDER_INSTANCE}" "${TARGET_INSTANCE}"; do
  if instance_is_listed "${instance}"; then
    echo "Lima instance ${instance} already exists; choose a fresh instance base." >&2
    exit 1
  else
    presence_status=$?
    if [[ "${presence_status}" -ne 1 ]]; then
      exit 1
    fi
  fi
done

mkdir -p "${OUTPUT_ROOT}"
git -C "${REPO_ROOT}" archive \
  --format=tar \
  --output="${ARCHIVE_PATH}" \
  "${COMMIT}"

lima create --tty=false --name "${BUILDER_INSTANCE}" "${BUILDER_CONFIG}"
lima start --tty=false "${BUILDER_INSTANCE}"
lima copy --backend=scp \
  "${ARCHIVE_PATH}" \
  "${BUILDER_INSTANCE}:/tmp/wharfie-steady-file-preview-repo.tar"
BUILDER_UID="$(lima shell --tty=false "${BUILDER_INSTANCE}" /usr/bin/id -u)"
BUILDER_GID="$(lima shell --tty=false "${BUILDER_INSTANCE}" /usr/bin/id -g)"
lima shell --tty=false "${BUILDER_INSTANCE}" \
  /usr/bin/sudo /usr/bin/rm -rf "${GUEST_BUILDER_ROOT}"
lima shell --tty=false "${BUILDER_INSTANCE}" \
  /usr/bin/sudo /usr/bin/mkdir -p "${GUEST_REPO}"
lima shell --tty=false "${BUILDER_INSTANCE}" \
  /usr/bin/sudo /usr/bin/chown \
  "${BUILDER_UID}:${BUILDER_GID}" "${GUEST_BUILDER_ROOT}" "${GUEST_REPO}"
lima shell --tty=false "${BUILDER_INSTANCE}" \
  /usr/bin/tar \
  --extract \
  --file=/tmp/wharfie-steady-file-preview-repo.tar \
  --directory="${GUEST_REPO}"
lima shell --tty=false --workdir "${GUEST_REPO}" "${BUILDER_INSTANCE}" \
  /usr/local/bin/npm ci --no-audit --no-fund
lima shell --tty=false --workdir "${GUEST_REPO}" "${BUILDER_INSTANCE}" \
  /usr/bin/env \
  "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
  "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
  /usr/local/bin/node \
  scripts/verify-steady-file-systemd-linux.js \
  build \
  "${GUEST_REPO}" \
  "${GUEST_HANDOFF_ROOT}" \
  "${GUEST_BUILDER_RECEIPT}"

for relative_path in "${HANDOFF_FILES[@]}"; do
  lima copy --backend=scp \
    "${BUILDER_INSTANCE}:${GUEST_HANDOFF_ROOT}/${relative_path}" \
    "${HOST_HANDOFF_ROOT}/${relative_path}"
  if [[ ! -f "${HOST_HANDOFF_ROOT}/${relative_path}" ]]; then
    echo "Builder did not emit required handoff file ${relative_path}." >&2
    exit 1
  fi
done
lima copy --backend=scp \
  "${BUILDER_INSTANCE}:${GUEST_BUILDER_RECEIPT}" \
  "${HOST_BUILDER_RECEIPT}"
if [[ ! -f "${HOST_BUILDER_RECEIPT}" ]]; then
  echo "Builder did not emit its receipt." >&2
  exit 1
fi

delete_and_assert_absent "${BUILDER_INSTANCE}"
if instance_is_listed "${BUILDER_INSTANCE}"; then
  echo "Builder must be absent before the clean target is created." >&2
  exit 1
else
  presence_status=$?
  if [[ "${presence_status}" -ne 1 ]]; then
    exit 1
  fi
fi

lima create --tty=false --name "${TARGET_INSTANCE}" "${TARGET_CONFIG}"
lima start --tty=false "${TARGET_INSTANCE}"
if lima shell --tty=false "${TARGET_INSTANCE}" \
  /usr/bin/env node --version >/dev/null 2>&1; then
  echo "The clean target unexpectedly contains Node." >&2
  exit 1
fi
if lima shell --tty=false "${TARGET_INSTANCE}" \
  /usr/bin/env npm --version >/dev/null 2>&1; then
  echo "The clean target unexpectedly contains npm." >&2
  exit 1
fi

lima shell --tty=false "${TARGET_INSTANCE}" \
  /usr/bin/mkdir -p \
  "${TARGET_HANDOFF_ROOT}/source" \
  "${TARGET_HANDOFF_ROOT}/target"
lima shell --tty=false "${TARGET_INSTANCE}" \
  /usr/bin/chmod 0700 \
  "${TARGET_ROOT}" \
  "${TARGET_HANDOFF_ROOT}" \
  "${TARGET_HANDOFF_ROOT}/source" \
  "${TARGET_HANDOFF_ROOT}/target"
for relative_path in "${HANDOFF_FILES[@]}"; do
  lima copy --backend=scp \
    "${HOST_HANDOFF_ROOT}/${relative_path}" \
    "${TARGET_INSTANCE}:${TARGET_HANDOFF_ROOT}/${relative_path}"
done
/usr/bin/printf '%s\n' \
  'literal steady-file systemd proof artifact' > "${HOST_INPUT_PATH}"
lima copy --backend=scp \
  "${HOST_INPUT_PATH}" \
  "${TARGET_INSTANCE}:${TARGET_INPUT_PATH}"
lima shell --tty=false "${TARGET_INSTANCE}" \
  /usr/bin/chmod 0500 \
  "${TARGET_HANDOFF_ROOT}/source/app" \
  "${TARGET_HANDOFF_ROOT}/target/app"
lima shell --tty=false "${TARGET_INSTANCE}" \
  /usr/bin/chmod 0400 \
  "${TARGET_HANDOFF_ROOT}/source/artifact-record.json" \
  "${TARGET_HANDOFF_ROOT}/target/artifact-record.json" \
  "${TARGET_HANDOFF_ROOT}/handoff.json" \
  "${TARGET_HANDOFF_ROOT}/SHA256SUMS"
lima shell --tty=false "${TARGET_INSTANCE}" \
  /usr/bin/chmod 0600 \
  "${TARGET_INPUT_PATH}"

CONTROLLER_PATH="$(dirname "${LIMACTL_BIN}"):${PATH}"
/usr/bin/env \
  "HOME=${HOST_HOME}" \
  "LIMA_HOME=${LIMA_HOME}" \
  "PATH=${CONTROLLER_PATH}" \
  "${NODE_BIN}" \
  "${REPO_ROOT}/scripts/verify-steady-file-preview-target.js" \
  prepare \
  "${TARGET_INSTANCE}" \
  "${HOST_HANDOFF_ROOT}" \
  "${COMMIT}" \
  "${HOST_PREPARE_RECEIPT}"
/usr/bin/env \
  "HOME=${HOST_HOME}" \
  "LIMA_HOME=${LIMA_HOME}" \
  "PATH=${CONTROLLER_PATH}" \
  "${NODE_BIN}" \
  "${REPO_ROOT}/scripts/verify-steady-file-preview-target.js" \
  verify \
  "${TARGET_INSTANCE}" \
  "${HOST_HANDOFF_ROOT}" \
  "${COMMIT}" \
  "${HOST_PREPARE_RECEIPT}" \
  "${HOST_FINAL_RECEIPT}"

for receipt in \
  "${HOST_BUILDER_RECEIPT}" \
  "${HOST_PREPARE_RECEIPT}" \
  "${HOST_FINAL_RECEIPT}"; do
  if [[ ! -f "${receipt}" ]]; then
    echo "A required proof receipt is missing: ${receipt}" >&2
    exit 1
  fi
  receipt_bytes="$(/usr/bin/wc -c < "${receipt}")"
  if ((receipt_bytes > 1024 * 1024)); then
    echo "Refusing to publish an unexpectedly large proof receipt." >&2
    exit 1
  fi
done

delete_and_assert_absent "${TARGET_INSTANCE}"
for instance in "${BUILDER_INSTANCE}" "${TARGET_INSTANCE}"; do
  if instance_is_listed "${instance}"; then
    echo "Disposable Lima instance ${instance} remains after proof completion." >&2
    exit 1
  else
    presence_status=$?
    if [[ "${presence_status}" -ne 1 ]]; then
      exit 1
    fi
  fi
done

RECEIPT_STAGING="$(mktemp -d "${OUTPUT_ROOT}/.${COMMIT}.XXXXXX")"
/bin/cp "${HOST_BUILDER_RECEIPT}" "${RECEIPT_STAGING}/builder.json"
/bin/cp "${HOST_PREPARE_RECEIPT}" "${RECEIPT_STAGING}/prepare.json"
/bin/cp "${HOST_FINAL_RECEIPT}" "${RECEIPT_STAGING}/final.json"

rm -rf "${TEMP_ROOT}"
if [[ -e "${TEMP_ROOT}" || -e "${LIMA_HOME}" ]]; then
  echo "Disposable proof workspace or Lima cache survived cleanup." >&2
  exit 1
fi
CLEANUP_COMPLETE=1

cleanup_observed_at="$(($(date +%s) * 1000))"
/usr/bin/printf \
  '%s\n' \
  "{\"schemaVersion\":1,\"kind\":\"wharfie.steady-file-preview.host-cleanup\",\"authority\":\"single-host-developer-preview\",\"authoritative\":true,\"commit\":\"${COMMIT}\",\"observedAt\":${cleanup_observed_at},\"builderInstance\":\"${BUILDER_INSTANCE}\",\"targetInstance\":\"${TARGET_INSTANCE}\",\"builderAbsent\":true,\"targetAbsent\":true,\"temporaryRootAbsent\":true,\"limaHomeAbsent\":true}" \
  > "${RECEIPT_STAGING}/cleanup.json"

pushd "${RECEIPT_STAGING}" >/dev/null
/usr/bin/shasum -a 256 \
  builder.json \
  prepare.json \
  final.json \
  cleanup.json > SHA256SUMS
popd >/dev/null
mv "${RECEIPT_STAGING}" "${RECEIPT_DIRECTORY}"
RECEIPT_STAGING=""

echo "Verified the split builder and clean-target steady-file preview for ${COMMIT}."
echo "Receipts: ${RECEIPT_DIRECTORY}"
