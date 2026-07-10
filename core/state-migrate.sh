#!/system/bin/sh

state_raw_get() {
  [ -f "$STATE_FILE" ] || return 0
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); value=$0; found=1 } END { if (found) print value }' "$STATE_FILE" 2>/dev/null
}

state_migration_backup() {
  STATE_MIGRATION_BACKUP="$STATE_DIR/state.pre-schema-$1.prop"
  cp -f "$STATE_FILE" "$STATE_MIGRATION_BACKUP" 2>/dev/null || return 1
  chmod 0600 "$STATE_MIGRATION_BACKUP" 2>/dev/null || true
}

state_migrate() {
  [ -f "$STATE_FILE" ] || return 0
  [ ! -L "$STATE_FILE" ] || return 1
  STATE_OLD_SCHEMA="$(state_raw_get schema_version)"
  case "$STATE_OLD_SCHEMA" in ""|*[!0-9]*) STATE_OLD_SCHEMA=0 ;; esac
  [ "$STATE_OLD_SCHEMA" -le "$STATE_SCHEMA_VERSION" ] 2>/dev/null || return 1
  if [ "$STATE_OLD_SCHEMA" = "$STATE_SCHEMA_VERSION" ] && state_schema_file_valid "$STATE_FILE"; then
    return 0
  fi

  mkdir -p "$STATE_DIR" 2>/dev/null || return 1
  state_migration_backup "$STATE_OLD_SCHEMA" || return 1
  STATE_MIGRATION_TMP="$STATE_FILE.migrate.$$"
  trap 'rm -f "$STATE_MIGRATION_TMP" 2>/dev/null' HUP INT TERM
  printf 'schema_version=%s\n' "$STATE_SCHEMA_VERSION" > "$STATE_MIGRATION_TMP" || return 1
  while IFS= read -r STATE_MIGRATION_LINE || [ -n "$STATE_MIGRATION_LINE" ]; do
    STATE_MIGRATION_KEY="$(state_pair_key "$STATE_MIGRATION_LINE" 2>/dev/null)" || continue
    [ "$STATE_MIGRATION_KEY" = schema_version ] && continue
    state_pair_valid "$STATE_MIGRATION_LINE" || continue
    grep -q "^$STATE_MIGRATION_KEY=" "$STATE_MIGRATION_TMP" 2>/dev/null && continue
    printf '%s\n' "$STATE_MIGRATION_LINE" >> "$STATE_MIGRATION_TMP" || return 1
  done < "$STATE_FILE"
  state_schema_file_valid "$STATE_MIGRATION_TMP" || return 1
  state_atomic_replace "$STATE_MIGRATION_TMP" "$STATE_FILE" 0600 || return 1
  trap - HUP INT TERM
  state_update \
    "migration.status=ok" \
    "migration.from=$STATE_OLD_SCHEMA" \
    "migration.to=$STATE_SCHEMA_VERSION" \
    "migration.updated_at=$(state_now)"
}
