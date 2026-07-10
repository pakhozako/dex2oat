#!/usr/bin/env sh
set -eu

ROOT="$1"
TMP_ROOT="${TMPDIR:-/tmp}/dex2oat-install-txn-test.$$"
trap 'rm -rf "$TMP_ROOT"' 0 HUP INT TERM
mkdir -p "$TMP_ROOT"

sed '/^OUTFD=/,$d' "$ROOT/META-INF/com/google/android/update-binary" > "$TMP_ROOT/install-lib.sh"
. "$TMP_ROOT/install-lib.sh"
. "$ROOT/core/common.sh"

DEX_STATE_ROOT="$TMP_ROOT/data/state"
DEX_MODULE_ROOT="$TMP_ROOT/data/module"
INSTALL_TXN_DIR="$TMP_ROOT/txn"
INSTALL_TXN_COMMITTED=0

mkdir -p "$DEX_STATE_ROOT" "$DEX_MODULE_ROOT/core"
printf 'old-state\n' > "$DEX_STATE_ROOT/state.prop"
printf 'old-module\n' > "$DEX_MODULE_ROOT/module.prop"
printf 'old-core\n' > "$DEX_MODULE_ROOT/core/state.sh"

install_transaction_prepare
[ -f "$INSTALL_TXN_DIR/status" ]
[ "$(cat "$INSTALL_TXN_DIR/status")" = prepared ]
[ -f "$INSTALL_TXN_DIR/state/state.prop" ]
[ -f "$INSTALL_TXN_DIR/module/module.prop" ]

rm -rf "$DEX_STATE_ROOT" "$DEX_MODULE_ROOT"
mkdir -p "$DEX_STATE_ROOT" "$DEX_MODULE_ROOT"
printf 'new-state\n' > "$DEX_STATE_ROOT/state.prop"
printf 'new-module\n' > "$DEX_MODULE_ROOT/module.prop"
install_transaction_rollback
grep -q '^old-state$' "$DEX_STATE_ROOT/state.prop"
grep -q '^old-module$' "$DEX_MODULE_ROOT/module.prop"
[ -d "$INSTALL_TXN_DIR" ]

rm -rf "$DEX_STATE_ROOT" "$DEX_MODULE_ROOT"
mkdir -p "$DEX_STATE_ROOT" "$DEX_MODULE_ROOT"
printf 'crash-state\n' > "$DEX_STATE_ROOT/state.prop"
install_transaction_recover_pending
grep -q '^old-state$' "$DEX_STATE_ROOT/state.prop"
grep -q '^old-module$' "$DEX_MODULE_ROOT/module.prop"
[ ! -d "$INSTALL_TXN_DIR" ]

mkdir -p "$DEX_STATE_ROOT" "$DEX_MODULE_ROOT/core"
printf 'state\n' > "$DEX_STATE_ROOT/state.prop"
for file in module.prop system.prop core/state.sh core/integrity-check.sh; do
  case "$file" in */*) mkdir -p "$DEX_MODULE_ROOT/${file%/*}" 2>/dev/null || true ;; esac
  printf 'x\n' > "$DEX_MODULE_ROOT/$file"
done
for file in customize.sh service.sh action.sh uninstall.sh; do
  printf '#!/system/bin/sh\n' > "$DEX_MODULE_ROOT/$file"
  chmod 0755 "$DEX_MODULE_ROOT/$file"
done
install_transaction_prepare
mkdir -p "$DEX_STATE_ROOT"
cat > "$DEX_STATE_ROOT/install.commit" <<EOF_MARKER
version=v6.0
module_path=$DEX_MODULE_ROOT
committed_at=test
boot_id=test
EOF_MARKER
install_transaction_finish
[ ! -d "$INSTALL_TXN_DIR" ]

rm -rf "$DEX_STATE_ROOT" "$DEX_MODULE_ROOT" "$INSTALL_TXN_DIR"
mkdir -p "$DEX_STATE_ROOT"
ln -s "$TMP_ROOT/missing" "$DEX_STATE_ROOT/bad-link" 2>/dev/null && {
  if install_transaction_prepare; then
    echo "prepare accepted a symlinked state tree" >&2
    exit 1
  fi
}

printf 'install transaction tests: ok\n'
