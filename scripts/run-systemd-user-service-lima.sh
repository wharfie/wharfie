#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEFAULT_INSTANCE="wharfie-systemd-proof-$$"
INSTANCE="${WHARFIE_SYSTEMD_PROOF_INSTANCE:-${DEFAULT_INSTANCE}}"
KEEP_VM="${WHARFIE_SYSTEMD_PROOF_KEEP_VM:-0}"
OUTPUT_ROOT="${WHARFIE_SYSTEMD_PROOF_OUTPUT_DIR:-${REPO_ROOT}/llm_artifacts/systemd-proof}"
CONFIG_PATH="${REPO_ROOT}/test/systemd/lima.yaml"
GUEST_REPO="/var/tmp/wharfie-systemd-proof-repo"
GUEST_PROOF_ROOT="/var/tmp/wharfie-systemd-proof"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wharfie-systemd-proof.XXXXXX")"
ARCHIVE_PATH="${TEMP_ROOT}/repo.tar"
PREPARE_CAPTURE="${TEMP_ROOT}/prepare.json"
PREPARE_LOG="${TEMP_ROOT}/prepare.log"
VERIFY_LOG="${TEMP_ROOT}/verify.log"
CREATED=0
RECEIPT_STAGING=""
COMMIT=""

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ "${status}" -ne 0 && "${CREATED}" -eq 1 ]]; then
    failure_directory=""
    if [[ -n "${COMMIT}" ]]; then
      failure_directory="${OUTPUT_ROOT}/failures/${COMMIT}"
      mkdir -p "${failure_directory}"
      if [[ -f "${PREPARE_CAPTURE}" ]]; then
        cp "${PREPARE_CAPTURE}" "${failure_directory}/prepare.json"
      fi
      if [[ -f "${PREPARE_LOG}" ]]; then
        cp "${PREPARE_LOG}" "${failure_directory}/prepare.log"
      fi
      if [[ -f "${VERIFY_LOG}" ]]; then
        cp "${VERIFY_LOG}" "${failure_directory}/verify.log"
      fi
    fi
    if limactl list --quiet "${INSTANCE}" >/dev/null 2>&1; then
      if [[ -n "${failure_directory}" ]] && limactl shell --tty=false "${INSTANCE}" \
        /usr/bin/test -f "${GUEST_PROOF_ROOT}/failure.json"; then
        limactl copy --backend=scp \
          "${INSTANCE}:${GUEST_PROOF_ROOT}/failure.json" \
          "${failure_directory}/failure.json" || true
      fi
      limactl shell --tty=false "${INSTANCE}" \
        /usr/bin/systemctl --user status \
        wharfie-systemd-service-proof.service \
        --no-pager --full || true
      limactl shell --tty=false "${INSTANCE}" \
        /usr/bin/journalctl --user \
        --boot=0 \
        --unit=wharfie-systemd-service-proof.service \
        --no-pager || true
      limactl shell --tty=false "${INSTANCE}" \
        /usr/bin/sudo /usr/bin/journalctl \
        --boot=0 \
        --unit=wharfie-systemd-proof-boot-check.service \
        --no-pager || true
    fi
    if [[ -n "${failure_directory}" ]]; then
      echo "Failure receipts: ${failure_directory}" >&2
    fi
  fi
  if [[ "${CREATED}" -eq 1 && "${KEEP_VM}" != "1" ]]; then
    limactl delete --force "${INSTANCE}" || true
  elif [[ "${CREATED}" -eq 1 ]]; then
    echo "Retained Lima instance ${INSTANCE} for inspection." >&2
  fi
  if [[ -n "${RECEIPT_STAGING}" ]]; then
    rm -rf "${RECEIPT_STAGING}"
  fi
  rm -rf "${TEMP_ROOT}"
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
if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=all)" ]]; then
  echo "Commit or remove worktree changes before creating a proof receipt." >&2
  exit 1
fi
if limactl list --quiet "${INSTANCE}" >/dev/null 2>&1; then
  echo "Lima instance ${INSTANCE} already exists; choose a fresh WHARFIE_SYSTEMD_PROOF_INSTANCE." >&2
  exit 1
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
limactl shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
  /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
  "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
  /usr/local/bin/node \
  scripts/verify-systemd-user-service-linux.js \
  prepare \
  "${GUEST_REPO}" > "${PREPARE_LOG}"
echo "Prepared three SEA revisions, installed the source service, and verified process replacement."
limactl copy --backend=scp \
  "${INSTANCE}:${GUEST_PROOF_ROOT}/prepare.json" \
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
echo "Verified boot recovery, two-release activation crash recovery, source restoration, and uninstall preservation."

RECEIPT_DIRECTORY="${OUTPUT_ROOT}/${COMMIT}"
if [[ -e "${RECEIPT_DIRECTORY}" ]]; then
  echo "Proof receipts already exist for ${COMMIT}; refusing to overwrite them." >&2
  exit 1
fi
RECEIPT_STAGING="$(mktemp -d "${OUTPUT_ROOT}/.${COMMIT}.XXXXXX")"
limactl copy --backend=scp \
  "${INSTANCE}:${GUEST_PROOF_ROOT}/prepare.json" \
  "${RECEIPT_STAGING}/prepare.json"
limactl copy --backend=scp \
  "${INSTANCE}:/var/lib/wharfie-systemd-proof/boot-receipt.json" \
  "${RECEIPT_STAGING}/boot-receipt.json"
limactl copy --backend=scp \
  "${INSTANCE}:${GUEST_PROOF_ROOT}/final.json" \
  "${RECEIPT_STAGING}/final.json"

pushd "${RECEIPT_STAGING}" >/dev/null
/usr/bin/shasum -a 256 prepare.json boot-receipt.json final.json > SHA256SUMS
popd >/dev/null
mv "${RECEIPT_STAGING}" "${RECEIPT_DIRECTORY}"
RECEIPT_STAGING=""

echo "Verified Wharfie systemd reboot and two-release activation proof for ${COMMIT}."
echo "Receipts: ${RECEIPT_DIRECTORY}"
