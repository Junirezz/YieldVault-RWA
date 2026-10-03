#!/bin/bash
# Bridge-compat ABI shape check (issue #1305).
#
# Verifies that the bridge-compat contract's ABI (exported functions + event
# topics) still matches the approved snapshot, and that the vault entry
# points the bridge integration relies on are still present after upgrades.
#
# Pure text analysis: runs without compiling, so it also gates while the
# workspace does not build. Regenerate the snapshot after an intentional
# change with:  bash scripts/check_bridge_abi.sh --update
#
# Exit status: 0 when the surface matches, 1 on drift (with a diff).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BRIDGE_SRC="$ROOT/contracts/bridge-compat/src"
VAULT_SRC="$ROOT/contracts/vault/src"
SNAPSHOT="$ROOT/contracts/bridge-compat/abi_snapshot.json"

# Test-only sources never contribute to a contract ABI.
is_test_source() {
  case "$1" in
    */tests/*|*/test.rs|*_tests.rs|*/fuzz_*.rs|*/deposit_withdraw_props.rs|*/benji_strategy.rs)
      return 0 ;;
    *) return 1 ;;
  esac
}

# Emit normalized `name(params) -> Ret` signatures for every `pub fn` inside a
# #[contractimpl] block found in the given files.
#
# The impl block ends at the first column-0 `}`: inside an impl, no other
# top-level item can start, so that brace necessarily closes it. Brace
# counting is deliberately avoided — string literals and comments routinely
# contain unbalanced braces.
extract_functions() {
  for file in "$@"; do
    is_test_source "$file" && continue
    awk '
      /#\[contractimpl\]/ { want_impl = 1; next }
      want_impl && /^[[:space:]]*impl[[:space:]]/ { in_impl = 1; want_impl = 0; next }
      in_impl && /^\}/ { in_impl = 0; next }
      in_impl && /^[[:space:]]*pub[[:space:]]+fn[[:space:]]/ {
        sig = $0
        while (sig !~ /\{/) {
          if ((getline nextline) <= 0) break
          sig = sig " " nextline
        }
        sub(/\{.*$/, "", sig)
        gsub(/[[:space:]]+/, " ", sig)
        gsub(/^ | $/, "", sig)
        print sig
      }
    ' "$file"
  done | sort -u
}

# Emit every symbol_short! topic used by non-test sources.
extract_events() {
  for file in "$@"; do
    is_test_source "$file" && continue
    grep -o 'symbol_short!("[^"]*")' "$file" 2>/dev/null || true
  done | sed 's/symbol_short!("//; s/")//' | sort -u
}

json_array() {
  # json_array < each line on stdin > prints "a", "b", ...
  local first=1
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    if [ "$first" -eq 1 ]; then first=0; else printf ",\n"; fi
    # identifiers/topics contain no quotes; escape backslashes defensively
    printf '      "%s"' "$(printf '%s' "$line" | sed 's/\\/\\\\/g')"
  done
}

generate_snapshot() {
  shopt -s nullglob
  local bridge_sources=("$BRIDGE_SRC"/*.rs)
  local vault_sources=("$VAULT_SRC"/*.rs)
  bridge_fns=$(extract_functions "${bridge_sources[@]}")
  bridge_events=$(extract_events "${bridge_sources[@]}")
  vault_fns=$(extract_functions "${vault_sources[@]}")
  {
    printf '{\n'
    printf '  "bridge": {\n'
    printf '    "functions": [\n'
    printf '%s\n' "$bridge_fns" | json_array
    printf '\n    ],\n'
    printf '    "events": [\n'
    printf '%s\n' "$bridge_events" | json_array
    printf '\n    ]\n'
    printf '  },\n'
    printf '  "vault": {\n'
    printf '    "functions": [\n'
    printf '%s\n' "$vault_fns" | json_array
    printf '\n    ]\n'
    printf '  }\n'
    printf '}\n'
  }
}

if [ "${1:-}" = "--update" ]; then
  generate_snapshot > "$SNAPSHOT"
  echo "snapshot written to $SNAPSHOT"
  exit 0
fi

if [ ! -f "$SNAPSHOT" ]; then
  echo "error: snapshot $SNAPSHOT does not exist; run with --update to create it" >&2
  exit 1
fi

tmp_current="$(mktemp)"
trap 'rm -f "$tmp_current"' EXIT
generate_snapshot > "$tmp_current"

if diff -u "$SNAPSHOT" "$tmp_current"; then
  echo "bridge ABI matches snapshot"
else
  echo ""
  echo "error: bridge-compat ABI surface drifted from contracts/bridge-compat/abi_snapshot.json" >&2
  echo "If the change is intentional, regenerate with: bash scripts/check_bridge_abi.sh --update" >&2
  exit 1
fi
