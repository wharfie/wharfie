#!/usr/bin/env bash
set -euo pipefail
umask 077

SOURCE_MODE="commit"
if [[ "$#" -gt 1 ]]; then
  echo "Usage: $0 [--snapshot]" >&2
  exit 1
fi
case "${1:-}" in
  "") ;;
  --snapshot) SOURCE_MODE="snapshot" ;;
  --help|-h)
    echo "Usage: $0 [--snapshot]"
    echo "Default: prove a clean committed checkout. --snapshot: commit an immutable source copy only in a private temporary repository."
    exit 0
    ;;
  *)
    echo "Usage: $0 [--snapshot]" >&2
    exit 1
    ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENARIO="${WHARFIE_SYSTEMD_PROOF_SCENARIO:-lifecycle}"
case "${SCENARIO}" in
  lifecycle)
    DEFAULT_INSTANCE="wfs-$$"
    DEFAULT_OUTPUT_ROOT="${REPO_ROOT}/llm_artifacts/systemd-proof"
    PROOF_UNIT_NAME="wharfie-systemd-service-proof.service"
    GUEST_PREPARE_NAME="prepare.json"
    GUEST_FINAL_NAME="final.json"
    ;;
  steady-file)
    DEFAULT_INSTANCE="wfst-$$"
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
HOST_HELPER_SOURCE="${REPO_ROOT}/scripts/systemd-proof-host.js"
GUEST_REPO="/var/tmp/wharfie-systemd-proof-repo"
GUEST_PROOF_ROOT="/var/tmp/wharfie-systemd-proof"
GUEST_PREPARE_PATH="${GUEST_PROOF_ROOT}/${GUEST_PREPARE_NAME}"
GUEST_FINAL_PATH="${GUEST_PROOF_ROOT}/${GUEST_FINAL_NAME}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "The Lima driver currently requires macOS; run the inner Linux verifier directly on other disposable hosts." >&2
  exit 1
fi
if ! command -v limactl >/dev/null 2>&1; then
  echo "limactl is required (Lima 2.1 or newer)." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "The proof host requires Node 24.13.1." >&2
  exit 1
fi
NODE_BIN="$(command -v node)"
LIMACTL_BIN="$(command -v limactl)"
if [[ "$(/usr/bin/env -i PATH=/usr/bin:/bin:/usr/sbin:/sbin LANG=C "${NODE_BIN}" --version)" != "v24.13.1" ]]; then
  echo "The proof host requires Node 24.13.1." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for the task-owned, digest-verified cloud image download." >&2
  exit 1
fi
CURL_BIN="$(command -v curl)"
if [[ ! "${INSTANCE}" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]]; then
  echo "WHARFIE_SYSTEMD_PROOF_INSTANCE is not a safe Lima instance name." >&2
  exit 1
fi
if [[ "${KEEP_VM}" != "0" && "${KEEP_VM}" != "1" ]]; then
  echo "WHARFIE_SYSTEMD_PROOF_KEEP_VM must be 0 or 1." >&2
  exit 1
fi

HOST_USER="$(id -un)"
TEMP_PARENT="${WHARFIE_SYSTEMD_PROOF_TEMP_PARENT:-/private/tmp}"
TEMP_PARENT="$(cd "${TEMP_PARENT}" && pwd -P)"
TEMP_ROOT="$(mktemp -d "${TEMP_PARENT%/}/wfs.XXXXXX")"
HOST_HELPER="${TEMP_ROOT}/host-helper.mjs"
PROOF_LIMA_HOME="${TEMP_ROOT}/lima"
PROOF_CACHE_ROOT="${TEMP_ROOT}/cache"
SOURCE_ROOT="${TEMP_ROOT}/source"
HOST_PROOF_ROOT="${TEMP_ROOT}/host"
ARCHIVE_PATH="${SOURCE_ROOT}/source.tar"
CONFIG_PATH="${HOST_PROOF_ROOT}/lima.yaml"
IMAGE_PLAN="${HOST_PROOF_ROOT}/image-plan.json"
PREPARE_CAPTURE="${TEMP_ROOT}/prepare.json"
PREPARE_LOG="${TEMP_ROOT}/prepare.log"
VERIFY_LOG="${TEMP_ROOT}/verify.log"
HOST_LOG="${TEMP_ROOT}/host.log"
CREATED=0
RECEIPT_STAGING=""
COMMIT=""

host() {
  /usr/bin/env -i \
    "PATH=/usr/bin:/bin:/usr/sbin:/sbin" \
    "HOME=${HOME}" \
    "USER=${HOST_USER}" \
    "LOGNAME=${HOST_USER}" \
    "LANG=en_US.UTF-8" \
    "TMPDIR=${TEMP_ROOT}/tmp" \
    "${NODE_BIN}" "${HOST_HELPER}" "$@"
}

# Do not inherit LIMA_* overrides, proxy credentials, SSH agents or user XDG
# configuration. HOME is passed through unchanged, never repurposed. On macOS
# Lima's Go cache cannot be isolated merely with XDG_CACHE_HOME: the verified
# local-only image config below avoids the downloader/global cache altogether.
lima() {
  printf 'limactl' >> "${HOST_LOG}"
  printf ' %q' "$@" >> "${HOST_LOG}"
  printf '\n' >> "${HOST_LOG}"
  /usr/bin/env -i \
    "PATH=${PATH}" \
    "HOME=${HOME}" \
    "USER=${HOST_USER}" \
    "LOGNAME=${HOST_USER}" \
    "LANG=en_US.UTF-8" \
    "TMPDIR=${TEMP_ROOT}/tmp" \
    "LIMA_HOME=${PROOF_LIMA_HOME}" \
    "XDG_CACHE_HOME=${PROOF_CACHE_ROOT}" \
    "XDG_CONFIG_HOME=${TEMP_ROOT}/config" \
    "${LIMACTL_BIN}" "$@" 2>> "${HOST_LOG}" | tee -a "${HOST_LOG}"
}

instance_is_listed() {
  local instances
  local candidate
  if ! instances="$(lima list --quiet)"; then
    echo "Failed to inspect the private Lima namespace." >&2
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
  if instance_is_listed; then
    :
  else
    presence_status=$?
    if [[ "${presence_status}" -eq 1 ]]; then
      CREATED=0
      return 0
    fi
    return 1
  fi
  if ! lima delete --force "${INSTANCE}"; then
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

copy_host_evidence() {
  local evidence
  [[ -n "${RECEIPT_STAGING}" && -d "${RECEIPT_STAGING}" ]] || return 0
  # A post-seal publish failure must preserve the sealed bytes, not rewrite
  # logs or add diagnostics behind an already published checksum manifest.
  [[ ! -f "${RECEIPT_STAGING}/SHA256SUMS" ]] || return 0
  for evidence in \
    "${SOURCE_ROOT}/source-provenance.json" \
    "${ARCHIVE_PATH}" \
    "${SOURCE_ROOT}/lima-original.yaml" \
    "${CONFIG_PATH}" \
    "${IMAGE_PLAN}" \
    "${HOST_PROOF_ROOT}/host-provenance.json" \
    "${HOST_PROOF_ROOT}/image-provenance.json" \
    "${PREPARE_CAPTURE}" \
    "${PREPARE_LOG}" \
    "${VERIFY_LOG}" \
    "${HOST_LOG}"; do
    if [[ -f "${evidence}" && ! -L "${evidence}" ]]; then
      cp "${evidence}" "${RECEIPT_STAGING}/$(basename "${evidence}")" || return 1
    fi
  done
}

remove_private_root() {
  if [[ ! -e "${TEMP_ROOT}" && ! -L "${TEMP_ROOT}" ]]; then
    return 0
  fi
  if [[ "${CREATED}" -ne 0 || -L "${TEMP_ROOT}" || ! -f "${TEMP_ROOT}/.wharfie-proof-owned" ]]; then
    echo "Refusing to remove private state whose VM absence or ownership is unproved: ${TEMP_ROOT}" >&2
    return 1
  fi
  if [[ "$(< "${TEMP_ROOT}/.wharfie-proof-owned")" != "${TEMP_ROOT}" ]]; then
    echo "Private proof directory ownership marker changed; retaining ${TEMP_ROOT}." >&2
    return 1
  fi
  case "${TEMP_ROOT}" in
    "${TEMP_PARENT}"/wfs.??????) ;;
    *) echo "Refusing an unexpected cleanup path: ${TEMP_ROOT}" >&2; return 1 ;;
  esac
  rm -rf "${TEMP_ROOT}"
  [[ ! -e "${TEMP_ROOT}" && ! -L "${TEMP_ROOT}" ]]
}

write_cleanup_receipt() {
  local status="$1"
  local instance_absent=false
  local instance_retained=true
  if [[ "${CREATED}" -eq 0 ]]; then
    instance_absent=true
    instance_retained=false
  fi
  host cleanup "${RECEIPT_STAGING}" "${SCENARIO}" "${COMMIT}" \
    "${INSTANCE}" "${PROOF_LIMA_HOME}" "${TEMP_ROOT}" \
    "${instance_absent}" "${instance_retained}" "${status}"
}

cleanup() {
  local status=$?
  local failure_directory
  trap - EXIT INT TERM
  set +e
  if [[ "${status}" -ne 0 && "${CREATED}" -eq 1 && -n "${RECEIPT_STAGING}" && ! -f "${RECEIPT_STAGING}/SHA256SUMS" ]]; then
    if instance_is_listed; then
      if lima shell --tty=false "${INSTANCE}" \
        /usr/bin/test -f "${GUEST_PROOF_ROOT}/failure.json"; then
        lima copy --backend=scp \
          "${INSTANCE}:${GUEST_PROOF_ROOT}/failure.json" \
          "${RECEIPT_STAGING}/failure.json" || true
      fi
      lima shell --tty=false "${INSTANCE}" \
        /usr/bin/systemctl --user status \
        "${PROOF_UNIT_NAME}" \
        --no-pager --full > "${RECEIPT_STAGING}/systemd-status.log" || true
      lima shell --tty=false "${INSTANCE}" \
        /usr/bin/journalctl --user \
        --boot=0 \
        --unit="${PROOF_UNIT_NAME}" \
        --no-pager > "${RECEIPT_STAGING}/service-journal.log" || true
      if [[ "${SCENARIO}" == "lifecycle" ]]; then
        lima shell --tty=false "${INSTANCE}" \
          /usr/bin/sudo /usr/bin/journalctl \
          --boot=0 \
          --unit=wharfie-systemd-proof-boot-check.service \
          --no-pager > "${RECEIPT_STAGING}/boot-journal.log" || true
      fi
    fi
  fi
  if [[ "${CREATED}" -eq 1 && "${KEEP_VM}" != "1" ]]; then
    delete_disposable_instance || status=1
  fi
  copy_host_evidence || status=1
  if [[ "${CREATED}" -eq 0 && ( -z "${RECEIPT_STAGING}" || "${HOST_HELPER}" == "${RECEIPT_STAGING}/host-helper.mjs" ) ]]; then
    remove_private_root || status=1
  elif [[ "${CREATED}" -eq 0 ]]; then
    echo "Retained private helper after receipt-staging failure: ${TEMP_ROOT}" >&2
  else
    echo "Retained private Lima instance ${INSTANCE}; inspect with LIMA_HOME=${PROOF_LIMA_HOME}. Private state: ${TEMP_ROOT}" >&2
  fi
  # Preserve even failed downloads, partial creates and cleanup failures in a
  # fresh checksummed failure directory. Never overwrite a previous attempt.
  if [[ -n "${RECEIPT_STAGING}" ]]; then
    status=1
    if [[ ! -e "${RECEIPT_STAGING}/cleanup.json" ]]; then
      write_cleanup_receipt "${status}" || true
    fi
    if [[ ! -e "${RECEIPT_STAGING}/SHA256SUMS" ]]; then
      host seal "${RECEIPT_STAGING}" || true
    fi
    if failure_directory="$(host publish "${RECEIPT_STAGING}" "${COMMIT}" failure)"; then
      echo "Failure receipts and logs: ${failure_directory}" >&2
      RECEIPT_STAGING=""
    else
      echo "Could not finalize failure receipts; retained staging: ${RECEIPT_STAGING}" >&2
    fi
  fi
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
printf '%s\n' "${TEMP_ROOT}" > "${TEMP_ROOT}/.wharfie-proof-owned"
mkdir "${PROOF_LIMA_HOME}" "${PROOF_CACHE_ROOT}" "${TEMP_ROOT}/tmp" "${TEMP_ROOT}/config"
[[ -f "${HOST_HELPER_SOURCE}" && ! -L "${HOST_HELPER_SOURCE}" ]]
cp "${HOST_HELPER_SOURCE}" "${HOST_HELPER}"
host paths "${PROOF_LIMA_HOME}" "${INSTANCE}"

COMMIT="$(host source "${SOURCE_MODE}" "${REPO_ROOT}" "${SOURCE_ROOT}")"
host verify-helper "${SOURCE_ROOT}/source-provenance.json"
RECEIPT_STAGING="$(host reserve "${OUTPUT_ROOT}" "${COMMIT}" "${TEMP_ROOT}")"
cp "${HOST_HELPER}" "${RECEIPT_STAGING}/host-helper.mjs"
HOST_HELPER="${RECEIPT_STAGING}/host-helper.mjs"
host verify-helper "${SOURCE_ROOT}/source-provenance.json"
copy_host_evidence
echo "Proof source mode: ${SOURCE_MODE}; immutable commit: ${COMMIT}. Original HEAD and content hashes are recorded in source-provenance.json."

IMAGE_URL="$(host image-plan "${SOURCE_ROOT}/lima-original.yaml" "$(uname -m)" "${PROOF_CACHE_ROOT}" "${HOST_PROOF_ROOT}")"
lima info > "${HOST_PROOF_ROOT}/lima-info.json"
host host-info "${HOST_PROOF_ROOT}/lima-info.json" "${PROOF_LIMA_HOME}" "${IMAGE_PLAN}"
if instance_is_listed; then
  echo "Unexpected instance in the newly owned private Lima namespace; refusing to mutate it." >&2
  exit 1
else
  presence_status=$?
  if [[ "${presence_status}" -ne 1 ]]; then
    exit 1
  fi
fi

echo "Downloading the pinned cloud image into ${PROOF_CACHE_ROOT}; the global Lima cache is not used."
/usr/bin/env -i \
  "PATH=/usr/bin:/bin:/usr/sbin:/sbin" \
  "LANG=en_US.UTF-8" \
  "TMPDIR=${TEMP_ROOT}/tmp" \
  "${CURL_BIN}" --disable --fail --location --proto '=https' --proto-redir '=https' \
  --silent --show-error --retry 2 --connect-timeout 20 --max-time 1800 \
  --output "${PROOF_CACHE_ROOT}/cloud-image.img" "${IMAGE_URL}" 2>> "${HOST_LOG}"
host verify-image "${IMAGE_PLAN}"
copy_host_evidence

CREATED=1
lima create --tty=false --mount-none --plain --containerd none --name "${INSTANCE}" "${CONFIG_PATH}"
lima start --tty=false "${INSTANCE}"
lima copy --backend=scp "${ARCHIVE_PATH}" "${INSTANCE}:/tmp/wharfie-systemd-proof-repo.tar"
lima shell --tty=false "${INSTANCE}" /bin/bash -lc \
  "set -euo pipefail; sudo rm -rf '${GUEST_REPO}'; sudo mkdir -p '${GUEST_REPO}'; sudo chown \"\$(id -u):\$(id -g)\" '${GUEST_REPO}'; tar -xf /tmp/wharfie-systemd-proof-repo.tar -C '${GUEST_REPO}'"
lima shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
  /usr/local/bin/npm ci --no-audit --no-fund
if [[ "${SCENARIO}" == "lifecycle" ]]; then
  lima shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
    /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
    "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
    /usr/local/bin/node \
    scripts/verify-systemd-user-service-linux.js \
    prepare \
    "${GUEST_REPO}" > "${PREPARE_LOG}"
  echo "Prepared three SEA revisions, installed and converged the service, proved crash restart fails closed, and explicitly took over and resumed."
  lima copy --backend=scp \
    "${INSTANCE}:${GUEST_PREPARE_PATH}" \
    "${PREPARE_CAPTURE}"

  lima stop --tty=false --force "${INSTANCE}"
  lima start --tty=false "${INSTANCE}"
  lima shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
    /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
    "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
    "WHARFIE_SYSTEMD_PROOF_POWER_CYCLE=forced-stop-start" \
    /usr/local/bin/node \
    scripts/verify-systemd-user-service-linux.js \
    verify \
    "${GUEST_REPO}" > "${VERIFY_LOG}"
  echo "Verified pre-login fail-closed boot and explicit recovery, both partial-adoption process kills, activation recovery, and retained history/output."
else
  lima shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
    /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
    "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
    /usr/local/bin/node \
    scripts/verify-steady-file-systemd-linux.js \
    prepare \
    "${GUEST_REPO}" > "${PREPARE_LOG}"
  echo "Ran the literal source and packaged steady-file CLIs, admitted default durable work, installed the service, and ended the initiating verifier."
  lima copy --backend=scp \
    "${INSTANCE}:${GUEST_PREPARE_PATH}" \
    "${PREPARE_CAPTURE}"

  lima shell --tty=false --workdir "${GUEST_REPO}" "${INSTANCE}" \
    /usr/bin/env "WHARFIE_SYSTEMD_PROOF_COMMIT=${COMMIT}" \
    "WHARFIE_SYSTEMD_PROOF_DISPOSABLE=lima" \
    /usr/local/bin/node \
    scripts/verify-steady-file-systemd-linux.js \
    verify \
    "${GUEST_REPO}" > "${VERIFY_LOG}"
  echo "Returned in a new verifier, observed unfinished work, read its result, updated, rolled back, uninstalled, and purged app data."
fi

lima copy --backend=scp \
  "${INSTANCE}:${GUEST_PREPARE_PATH}" \
  "${RECEIPT_STAGING}/prepare.json"
if [[ "${SCENARIO}" == "lifecycle" ]]; then
  lima copy --backend=scp \
    "${INSTANCE}:/var/lib/wharfie-systemd-proof/boot-receipt.json" \
    "${RECEIPT_STAGING}/boot-receipt.json"
fi
lima copy --backend=scp \
  "${INSTANCE}:${GUEST_FINAL_PATH}" \
  "${RECEIPT_STAGING}/final.json"

if [[ "${KEEP_VM}" != "1" ]]; then
  delete_disposable_instance
fi
copy_host_evidence
if [[ "${CREATED}" -eq 0 ]]; then
  remove_private_root
fi
write_cleanup_receipt 0
host seal "${RECEIPT_STAGING}"
RECEIPT_DIRECTORY="$(host publish "${RECEIPT_STAGING}" "${COMMIT}" success)"
RECEIPT_STAGING=""

if [[ "${SCENARIO}" == "lifecycle" ]]; then
  echo "Verified Wharfie systemd reboot and two-release activation proof for ${COMMIT}."
else
  echo "Verified the literal steady-file systemd lifecycle for ${COMMIT}."
fi
echo "Receipts: ${RECEIPT_DIRECTORY}"
