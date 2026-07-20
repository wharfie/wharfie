#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTANCE="${WHARFIE_SYSTEMD_PROOF_INSTANCE:-wharfie-systemd-proof}"
KEEP_VM="${WHARFIE_SYSTEMD_PROOF_KEEP_VM:-0}"
OUTPUT_ROOT="${WHARFIE_SYSTEMD_PROOF_OUTPUT_DIR:-${REPO_ROOT}/llm_artifacts/systemd-proof}"
CONFIG_PATH="${REPO_ROOT}/test/systemd/lima.yaml"
GUEST_REPO="/var/tmp/wharfie-systemd-proof-repo"
GUEST_PROOF_ROOT="/var/tmp/wharfie-systemd-proof"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/wharfie-systemd-proof.XXXXXX")"
ARCHIVE_PATH="${TEMP_ROOT}/repo.tar"
CREATED=0

cleanup() {
  status=$?
  trap - EXIT INT TERM
  if [[ "${status}" -ne 0 && "${CREATED}" -eq 1 ]]; then
    limactl shell --tty=false "${INSTANCE}" \
      /usr/bin/sudo /usr/bin/journalctl \
      --boot=0 \
      --unit=wharfie-systemd-proof-boot-check.service \
      --unit=wharfie-systemd-service-proof.service \
      --no-pager || true
  fi
  if [[ "${CREATED}" -eq 1 && "${KEEP_VM}" != "1" ]]; then
    limactl delete --force "${INSTANCE}" || true
  elif [[ "${CREATED}" -eq 1 ]]; then
    echo "Retained Lima instance ${INSTANCE} for inspection." >&2
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
if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain --untracked-files=all)" ]]; then
  echo "Commit or remove worktree changes before creating a proof receipt." >&2
  exit 1
fi
if limactl info "${INSTANCE}" >/dev/null 2>&1; then
  echo "Lima instance ${INSTANCE} already exists; choose a fresh WHARFIE_SYSTEMD_PROOF_INSTANCE." >&2
  exit 1
fi

COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
mkdir -p "${OUTPUT_ROOT}"
git -C "${REPO_ROOT}" archive \
  --format=tar \
  --output="${ARCHIVE_PATH}" \
  "${COMMIT}"

limactl create --tty=false --name "${INSTANCE}" "${CONFIG_PATH}"
CREATED=1
limactl start --tty=false "${INSTANCE}"
limactl copy --backend=scp "${ARCHIVE_PATH}" "${INSTANCE}:/tmp/wharfie-systemd-proof-repo.tar"
limactl shell --tty=false "${INSTANCE}" /bin/bash -lc \
  "set -euo pipefail; sudo rm -rf '${GUEST_REPO}'; sudo mkdir -p '${GUEST_REPO}'; sudo chown \"\$(id -u):\$(id -g)\" '${GUEST_REPO}'; tar -xf /tmp/wharfie-systemd-proof-repo.tar -C '${GUEST_REPO}'"
limactl shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
  /usr/local/bin/npm ci --no-audit --no-fund
limactl shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
  /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
  /usr/local/bin/node \
  scripts/verify-systemd-user-service-linux.js \
  prepare \
  "${GUEST_REPO}"

limactl restart --tty=false "${INSTANCE}"
limactl shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
  /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
  /usr/local/bin/node \
  scripts/verify-systemd-user-service-linux.js \
  verify \
  "${GUEST_REPO}"

RECEIPT_DIRECTORY="${OUTPUT_ROOT}/${COMMIT}"
mkdir -p "${RECEIPT_DIRECTORY}"
limactl copy --backend=scp \
  "${INSTANCE}:${GUEST_PROOF_ROOT}/prepare.json" \
  "${RECEIPT_DIRECTORY}/prepare.json"
limactl copy --backend=scp \
  "${INSTANCE}:/var/lib/wharfie-systemd-proof/boot-receipt.json" \
  "${RECEIPT_DIRECTORY}/boot-receipt.json"
limactl copy --backend=scp \
  "${INSTANCE}:${GUEST_PROOF_ROOT}/final.json" \
  "${RECEIPT_DIRECTORY}/final.json"

echo "Verified Wharfie systemd user-service reboot proof for ${COMMIT}."
echo "Receipts: ${RECEIPT_DIRECTORY}"
