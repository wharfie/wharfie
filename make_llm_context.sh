#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   ./make_llm_context.sh [OUTPUT_FILE]
#
# Env vars:
#   LLM_CONTEXT_IGNORE_FILE   path to ignore file (default: .llm_context_ignore)
#   LLM_CONTEXT_MAX_BYTES     skip files bigger than this many bytes (default: 0 = no limit)
#   LLM_CONTEXT_DEBUG         set to 1 to print ignore-match reasons to stderr

OUTPUT_FILE="${1:-LLM_CONTEXT}"
EXTRA_IGNORE_FILE="${LLM_CONTEXT_IGNORE_FILE:-.llm_context_ignore}"
MAX_BYTES="${LLM_CONTEXT_MAX_BYTES:-0}"
DEBUG="${LLM_CONTEXT_DEBUG:-0}"

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "error: not inside a git repository" >&2
  exit 1
}
cd "$ROOT"

TMP_OUT="$(mktemp "${TMPDIR:-/tmp}/llm_context.out.XXXXXX")"
TMP_EXCLUDES="$(mktemp "${TMPDIR:-/tmp}/llm_context.excludes.XXXXXX")"
trap 'rm -f "$TMP_OUT" "$TMP_EXCLUDES"' EXIT

# Build a combined excludes file:
# - keep user's global excludes (core.excludesfile) if configured
# - append repo-local extra ignores from .llm_context_ignore (or env override)
GLOBAL_EXCLUDES="$(git config --path --get core.excludesfile 2>/dev/null || true)"

if [[ -n "${GLOBAL_EXCLUDES:-}" && -f "$GLOBAL_EXCLUDES" ]]; then
  cat "$GLOBAL_EXCLUDES" >> "$TMP_EXCLUDES"
  printf "\n" >> "$TMP_EXCLUDES"
fi

if [[ -f "$EXTRA_IGNORE_FILE" ]]; then
  cat "$EXTRA_IGNORE_FILE" >> "$TMP_EXCLUDES"
  printf "\n" >> "$TMP_EXCLUDES"
fi

# Only override core.excludesfile if we actually have something to add/merge.
GIT_EXCLUDE_ARGS=()
if [[ -s "$TMP_EXCLUDES" ]]; then
  GIT_EXCLUDE_ARGS=(-c "core.excludesfile=$TMP_EXCLUDES")
fi

is_binary() {
  local f="$1"

  [[ -s "$f" ]] || return 1

  if command -v file >/dev/null 2>&1; then
    local enc=""
    enc="$(file -b --mime-encoding -- "$f" 2>/dev/null || true)"
    if [[ -n "$enc" ]]; then
      [[ "$enc" == "binary" ]] && return 0 || return 1
    fi

    local mime=""
    mime="$(file -bI -- "$f" 2>/dev/null || true)"
    [[ "$mime" == *"charset=binary"* ]] && return 0 || return 1
  fi

  LC_ALL=C grep -Iq . -- "$f" >/dev/null 2>&1 && return 1 || return 0
}

{
  printf "# LLM_CONTEXT\n"
  printf "# Repo root: %s\n" "$ROOT"
  printf "# Commit: %s\n" "$(git rev-parse HEAD 2>/dev/null || true)"
  printf "# Generated (UTC): %s\n" "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  printf "# Extra ignore file: %s (%s)\n" \
    "$EXTRA_IGNORE_FILE" \
    "$([[ -f "$EXTRA_IGNORE_FILE" ]] && echo "present" || echo "missing")"
  printf "\n"
} > "$TMP_OUT"

# List files:
# - tracked: --cached
# - untracked (not ignored): --others --exclude-standard
# Note: ignore patterns don't normally exclude tracked files, so we ALSO filter with
# `git check-ignore --no-index` below to enforce ignores even on tracked content.
git "${GIT_EXCLUDE_ARGS[@]}" ls-files -z --cached --others --exclude-standard |
while IFS= read -r -d '' path; do
  [[ "$path" == "$OUTPUT_FILE" ]] && continue

  # Enforce ignore rules (including .llm_context_ignore) even if the file is tracked
  if git "${GIT_EXCLUDE_ARGS[@]}" check-ignore --no-index -q -- "$path"; then
    if [[ "$DEBUG" == "1" ]]; then
      git "${GIT_EXCLUDE_ARGS[@]}" check-ignore --no-index -v -- "$path" >&2 || true
    fi
    continue
  else
    rc=$?
    if [[ $rc -gt 1 ]]; then
      echo "error: git check-ignore failed (rc=$rc) for: $path" >&2
      exit $rc
    fi
  fi

  if [[ -L "$path" ]]; then
    printf "===== FILE: %s =====\n" "$path" >> "$TMP_OUT"
    printf "[[SYMLINK -> %s]]\n\n" "$(readlink "$path" 2>/dev/null || echo "?")" >> "$TMP_OUT"
    continue
  fi

  [[ -f "$path" ]] || continue

  if [[ "$MAX_BYTES" -gt 0 ]]; then
    size="$(wc -c < "$path" | tr -d ' ')"
    if [[ "$size" -gt "$MAX_BYTES" ]]; then
      printf "===== FILE: %s =====\n" "$path" >> "$TMP_OUT"
      printf "[[SKIPPED: %s bytes > LLM_CONTEXT_MAX_BYTES=%s]]\n\n" "$size" "$MAX_BYTES" >> "$TMP_OUT"
      continue
    fi
  fi

  if is_binary "$path"; then
    printf "===== FILE: %s =====\n" "$path" >> "$TMP_OUT"
    printf "[[BINARY FILE SKIPPED]]\n\n" >> "$TMP_OUT"
    continue
  fi

  printf "===== FILE: %s =====\n" "$path" >> "$TMP_OUT"
  cat -- "$path" >> "$TMP_OUT" || printf "\n[[ERROR: could not read file]]\n" >> "$TMP_OUT"
  printf "\n\n" >> "$TMP_OUT"
done

mv -f "$TMP_OUT" "$OUTPUT_FILE"
echo "Wrote $OUTPUT_FILE ($(wc -c < "$OUTPUT_FILE" | tr -d ' ') bytes)"