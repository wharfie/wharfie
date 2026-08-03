#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENARIO="${WHARFIE_SYSTEMD_PROOF_SCENARIO:-lifecycle}"
case "${SCENARIO}" in
  lifecycle)
    DEFAULT_INSTANCE="wharfie-systemd-proof-$$"
    DEFAULT_OUTPUT_ROOT="${REPO_ROOT}/llm_artifacts/systemd-proof"
    PROOF_UNIT_NAME="wharfie-systemd-service-proof.service"
    GUEST_PREPARE_NAME="prepare.json"
    GUEST_FINAL_NAME="final.json"
    ;;
  steady-file)
    DEFAULT_INSTANCE="wharfie-steady-file-proof-$$"
    DEFAULT_OUTPUT_ROOT="${REPO_ROOT}/llm_artifacts/steady-file-systemd-proof"
    PROOF_UNIT_NAME="wharfie-steady-file-demo.service"
    GUEST_PREPARE_NAME="steady-file-prepare.json"
    GUEST_FINAL_NAME="steady-file-final.json"
    ;;
  *)
    echo "WHARFIE_SYSTEMD_PROOF_SCENARIO must be lifecycle or steady-file." >&2
    exit 1
    ;;
esac
INSTANCE="${WHARFIE_SYSTEMD_PROOF_INSTANCE:-${DEFAULT_INSTANCE}}"
KEEP_VM="${WHARFIE_SYSTEMD_PROOF_KEEP_VM:-0}"
OUTPUT_ROOT="${WHARFIE_SYSTEMD_PROOF_OUTPUT_DIR:-${DEFAULT_OUTPUT_ROOT}}"
CONFIG_PATH="${REPO_ROOT}/test/systemd/lima.yaml"
GUEST_REPO="/var/tmp/wharfie-systemd-proof-repo"
GUEST_PROOF_ROOT="/var/tmp/wharfie-systemd-proof"
GUEST_PREPARE_PATH="${GUEST_PROOF_ROOT}/${GUEST_PREPARE_NAME}"
GUEST_FINAL_PATH="${GUEST_PROOF_ROOT}/${GUEST_FINAL_NAME}"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wharfie-systemd-proof.XXXXXX")"
ARCHIVE_PATH="${TEMP_ROOT}/repo.tar"
PREPARE_CAPTURE="${TEMP_ROOT}/prepare.json"
PREPARE_LOG="${TEMP_ROOT}/prepare.log"
VERIFY_LOG="${TEMP_ROOT}/verify.log"
CREATED=0
RECEIPT_STAGING=""
COMMIT=""

instance_is_listed() {
  local instances
  local candidate
  if ! instances="$(limactl list --quiet)"; then
    echo "Failed to inspect Lima instances." >&2
    return 2
  fi
  while IFS= read -r candidate; do
    if [[ "${candidate}" == "${INSTANCE}" ]]; then
      return 0
    fi
  done <<< "${instances}"
  return 1
}

delete_disposable_instance() {
  local presence_status
  if ! limactl delete --force "${INSTANCE}"; then
    echo "Failed to delete Lima instance ${INSTANCE}." >&2
    return 1
  fi
  if instance_is_listed; then
    echo "Lima instance ${INSTANCE} still exists after deletion." >&2
    return 1
  else
    presence_status=$?
    if [[ "${presence_status}" -ne 1 ]]; then
      return 1
    fi
  fi
  CREATED=0
  echo "Deleted disposable Lima instance ${INSTANCE}."
}

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ "${status}" -ne 0 && "${CREATED}" -eq 1 ]]; then
    failure_directory=""
    if [[ -n "${COMMIT}" ]]; then
      failure_directory="${OUTPUT_ROOT}/failures/${COMMIT}"
      if ! mkdir -p "${failure_directory}"; then
        echo "Could not create failure receipt directory." >&2
        failure_directory=""
      fi
      if [[ -n "${failure_directory}" && -f "${PREPARE_CAPTURE}" ]]; then
        cp "${PREPARE_CAPTURE}" "${failure_directory}/prepare.json" ||
          echo "Could not retain prepare receipt." >&2
      fi
      if [[ -n "${failure_directory}" && -f "${PREPARE_LOG}" ]]; then
        cp "${PREPARE_LOG}" "${failure_directory}/prepare.log" ||
          echo "Could not retain prepare log." >&2
      fi
      if [[ -n "${failure_directory}" && -f "${VERIFY_LOG}" ]]; then
        cp "${VERIFY_LOG}" "${failure_directory}/verify.log" ||
          echo "Could not retain verify log." >&2
      fi
    fi
    if instance_is_listed; then
      if [[ -n "${failure_directory}" ]] && limactl shell --tty=false "${INSTANCE}" \
        /usr/bin/test -f "${GUEST_PROOF_ROOT}/failure.json"; then
        limactl copy --backend=scp \
          "${INSTANCE}:${GUEST_PROOF_ROOT}/failure.json" \
          "${failure_directory}/failure.json" || true
      fi
      limactl shell --tty=false "${INSTANCE}" \
        /usr/bin/systemctl --user status \
        "${PROOF_UNIT_NAME}" \
        --no-pager --full || true
      limactl shell --tty=false "${INSTANCE}" \
        /usr/bin/journalctl --user \
        --boot=0 \
        --unit="${PROOF_UNIT_NAME}" \
        --no-pager || true
      if [[ "${SCENARIO}" == "lifecycle" ]]; then
        limactl shell --tty=false "${INSTANCE}" \
          /usr/bin/sudo /usr/bin/journalctl \
          --boot=0 \
          --unit=wharfie-systemd-proof-boot-check.service \
          --no-pager || true
      fi
    fi
    if [[ -n "${failure_directory}" ]]; then
      echo "Failure receipts: ${failure_directory}" >&2
    fi
  fi
  if [[ "${CREATED}" -eq 1 && "${KEEP_VM}" != "1" ]]; then
    delete_disposable_instance || status=1
  elif [[ "${CREATED}" -eq 1 ]]; then
    echo "Retained Lima instance ${INSTANCE} for inspection." >&2
  fi
  if [[ -n "${RECEIPT_STAGING}" ]]; then
    rm -rf "${RECEIPT_STAGING}" || status=1
  fi
  rm -rf "${TEMP_ROOT}" || status=1
  exit "${status}"
}
trap cleanup EXIT INT TERM

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The Lima driver currently requires macOS; run the inner Linux verifier directly on other disposable hosts." >&2
  exit 1
fi
if ! command -v limactl >/dev/null 2>&1; then
  echo "limactl is required (Lima 2.1 or newer)." >&2
  exit 1
fi
if [[ ! "${INSTANCE}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
  echo "WHARFIE_SYSTEMD_PROOF_INSTANCE is not a safe Lima instance name." >&2
  exit 1
fi
if [[ "${KEEP_VM}" != "0" && "${KEEP_VM}" != "1" ]]; then
  echo "WHARFIE_SYSTEMD_PROOF_KEEP_VM must be 0 or 1." >&2
  exit 1
fi
WORKTREE_STATUS="$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=all)"
if [[ -n "${WORKTREE_STATUS}" ]]; then
  echo "Commit or remove worktree changes before creating a proof receipt." >&2
  exit 1
fi
if instance_is_listed; then
  echo "Lima instance ${INSTANCE} already exists; choose a fresh WHARFIE_SYSTEMD_PROOF_INSTANCE." >&2
  exit 1
else
  presence_status=$?
  if [[ "${presence_status}" -ne 1 ]]; then
    exit 1
  fi
fi

COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
mkdir -p "${OUTPUT_ROOT}"
git -C "${REPO_ROOT}" archive \
  --format=tar \
  --output="${ARCHIVE_PATH}" \
  "${COMMIT}"

CREATED=1
limactl create --tty=false --name "${INSTANCE}" "${CONFIG_PATH}"
limactl start --tty=false "${INSTANCE}"
limactl copy --backend=scp "${ARCHIVE_PATH}" "${INSTANCE}:/tmp/wharfie-systemd-proof-repo.tar"
limactl shell --tty=false "${INSTANCE}" /bin/bash -lc \
  "set -euo pipefail; sudo rm -rf '${GUEST_REPO}'; sudo mkdir -p '${GUEST_REPO}'; sudo chown \"\$(id -u):\$(id -g)\" '${GUEST_REPO}'; tar -xf /tmp/wharfie-systemd-proof-repo.tar -C '${GUEST_REPO}'"
limactl shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
  /usr/local/bin/npm ci --no-audit --no-fund
if [[ "${SCENARIO}" == "lifecycle" ]]; then
  limactl shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
    /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
    "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
    /usr/local/bin/node \
    scripts/verify-systemd-user-service-linux.js \
    prepare \
    "${GUEST_REPO}" > "${PREPARE_LOG}"
  echo "Prepared three SEA revisions, exercised default durable argv, installed and converged the source service, and verified process replacement."
  limactl copy --backend=scp \
    "${INSTANCE}:${GUEST_PREPARE_PATH}" \
    "${PREPARE_CAPTURE}"

  limactl stop --tty=false --force "${INSTANCE}"
  limactl start --tty=false "${INSTANCE}"
  limactl shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
    /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
    "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
    "WHARFIE_SYSTEMD_PROOF_POWER_CYCLE=forced-stop-start" \
    /usr/local/bin/node \
    scripts/verify-systemd-user-service-linux.js \
    verify \
    "${GUEST_REPO}" > "${VERIFY_LOG}"
  echo "Verified boot recovery, history and output reads, two-release activation crash recovery, source restoration, and uninstall preservation."
else
  limactl shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
    /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
    "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
    /usr/local/bin/node \
    scripts/verify-steady-file-systemd-linux.js \
    prepare \
    "${GUEST_REPO}" > "${PREPARE_LOG}"
  echo "Ran the literal source and packaged steady-file CLIs, admitted default durable work, installed the service, and ended the initiating verifier."
  limactl copy --backend=scp \
    "${INSTANCE}:${GUEST_PREPARE_PATH}" \
    "${PREPARE_CAPTURE}"

  limactl shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
    /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
    "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
    /usr/local/bin/node \
    scripts/verify-steady-file-systemd-linux.js \
    verify \
    "${GUEST_REPO}" > "${VERIFY_LOG}"
  echo "Returned in a new verifier, observed unfinished work, read its result, updated, rolled back, uninstalled, and purged app data."
fi

RECEIPT_DIRECTORY="${OUTPUT_ROOT}/${COMMIT}"
if [[ -e "${RECEIPT_DIRECTORY}" ]]; then
  echo "Proof receipts already exist for ${COMMIT}; refusing to overwrite them." >&2
  exit 1
fi
RECEIPT_STAGING="$(mktemp -d "${OUTPUT_ROOT}/.${COMMIT}.XXXXXX")"
limactl copy --backend=scp \
  "${INSTANCE}:${GUEST_PREPARE_PATH}" \
  "${RECEIPT_STAGING}/prepare.json"
if [[ "${SCENARIO}" == "lifecycle" ]]; then
  limactl copy --backend=scp \
    "${INSTANCE}:/var/lib/wharfie-systemd-proof/boot-receipt.json" \
    "${RECEIPT_STAGING}/boot-receipt.json"
fi
limactl copy --backend=scp \
  "${INSTANCE}:${GUEST_FINAL_PATH}" \
  "${RECEIPT_STAGING}/final.json"

if [[ "${KEEP_VM}" == "1" ]]; then
  instance_absent=false
  instance_retained=true
else
  delete_disposable_instance
  instance_absent=true
  instance_retained=false
fi
cleanup_observed_at="$(($(date +%s) * 1000))"
if [[ "${SCENARIO}" == "lifecycle" ]]; then
  cleanup_kind="wharfie.systemd-proof.host-cleanup"
else
  cleanup_kind="wharfie.steady-file-systemd-proof.host-cleanup"
fi
/usr/bin/printf \
  '%s\n' \
  "{\"schemaVersion\":1,\"kind\":\"${cleanup_kind}\",\"authority\":\"none\",\"authoritative\":false,\"commit\":\"${COMMIT}\",\"instance\":\"${INSTANCE}\",\"observedAt\":${cleanup_observed_at},\"instanceAbsent\":${instance_absent},\"instanceRetained\":${instance_retained}}" \
  > "${RECEIPT_STAGING}/cleanup.json"

pushd "${RECEIPT_STAGING}" >/dev/null
if [[ "${SCENARIO}" == "lifecycle" ]]; then
  /usr/bin/shasum -a 256 \
    prepare.json \
    boot-receipt.json \
    final.json \
    cleanup.json > SHA256SUMS
else
  /usr/bin/shasum -a 256 \
    prepare.json \
    final.json \
    cleanup.json > SHA256SUMS
fi
popd >/dev/null
mv "${RECEIPT_STAGING}" "${RECEIPT_DIRECTORY}"
RECEIPT_STAGING=""

if [[ "${SCENARIO}" == "lifecycle" ]]; then
  echo "Verified Wharfie systemd reboot and two-release activation proof for ${COMMIT}."
else
  echo "Verified the literal steady-file systemd lifecycle for ${COMMIT}."
fi
echo "Receipts: ${RECEIPT_DIRECTORY}"
