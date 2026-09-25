#!/bin/bash

set -e

function help {
  echo "Available commands:"
  echo "  backup [volumes...] - backup volumes, defaults to all"
  echo "  restore <backup name> [volumes...] - restore from backup with name (latest points to last one)"
  echo "  store <backup name> <file> - save stdin as <file> inside an existing backup (used for database dumps)"
  echo "  seal <backup name> [stopped|running] - write the COMPLETE manifest once every volume and dump is in"
  echo "  list - show backup names, whether each is complete, and how many volumes it holds"
  exit 1
}

[ $# -eq 0 ] && help

cmd=$1

case $cmd in
  backup)
    shift
    (
      backupname=$(date +%Y_%m_%d_%H_%M_%S)
      echo -n "Creating backup $backupname ..."
      mkdir "$BACKUP_ROOT/$backupname"
      cd $VOLUMES_ROOT
      for vol in ${@:-$VOLUMES}; do
        echo -n " $vol"
        tar cf $BACKUP_ROOT/$backupname/$vol.tar $vol
      done
      echo " done"
    )
    ;;
  restore)
    shift
    (
      backupname=$1
      [ ! -d "$BACKUP_ROOT/$backupname" ] && {
        echo "Backup $backupname does not exists. Use list command to see available"
        exit 1
      }
      shift

      # Refuse before extracting anything: a backup without its COMPLETE
      # manifest was cut short (or predates the manifest), and restoring part
      # of one leaves the stack half rolled back.
      manifest="$BACKUP_ROOT/$backupname/COMPLETE"
      if [ ! -f "$manifest" ]; then
        echo "Backup $backupname is not complete: it has no COMPLETE manifest. Refusing to restore; nothing was extracted."
        exit 1
      fi
      missing=""
      # shellcheck disable=SC2068  # volume names are words, as in backup below
      for vol in ${@:-$VOLUMES}; do
        if [ ! -f "$BACKUP_ROOT/$backupname/$vol.tar" ] || ! grep -q "^file=$vol.tar$(printf '\t')" "$manifest"; then
          missing="$missing $vol"
        fi
      done
      if [ -n "$missing" ]; then
        echo "Backup $backupname is missing:$missing. Refusing to restore; nothing was extracted."
        exit 1
      fi
      if grep -q '^services=running' "$manifest"; then
        echo "WARNING: backup $backupname was taken while the services were running; databases in it may be inconsistent"
      fi

      echo -n "Restoring backup $backupname ..."
      for vol in ${@:-$VOLUMES}; do
        echo -n " $vol"
        cd $VOLUMES_ROOT/$vol
        tar xf $BACKUP_ROOT/$backupname/$vol.tar --strip=1
      done
      echo " done"
    )
    ;;
  store)
    shift
    (
      backupname=$1
      file=$2
      [ -z "$backupname" ] || [ -z "$file" ] && help
      # A plain file name only: no path parts
      case "$file" in
        */*|.*) echo "Invalid file name $file"; exit 1 ;;
      esac
      [ ! -d "$BACKUP_ROOT/$backupname" ] && {
        echo "Backup $backupname does not exists. Use list command to see available"
        exit 1
      }
      # Write beside the final name and rename, so a cut stream never leaves a
      # file that looks complete
      cat > "$BACKUP_ROOT/$backupname/$file.partial"
      # A dump cut short (mongodump failed) ends the stream early: refuse a
      # gzip file that does not read back whole
      case "$file" in
        *.gz) gzip -t "$BACKUP_ROOT/$backupname/$file.partial" || { rm -f "$BACKUP_ROOT/$backupname/$file.partial"; echo "Stream for $file is not a complete gzip file"; exit 1; } ;;
      esac
      mv "$BACKUP_ROOT/$backupname/$file.partial" "$BACKUP_ROOT/$backupname/$file"
      echo "Stored $file in backup $backupname"
    )
    ;;
  seal)
    shift
    (
      backupname=$1
      mode=${2:-unknown}
      [ -z "$backupname" ] && help
      case "$mode" in
        stopped|running|unknown) ;;
        *) echo "Invalid mode $mode"; exit 1 ;;
      esac
      dir="$BACKUP_ROOT/$backupname"
      [ ! -d "$dir" ] && {
        echo "Backup $backupname does not exists. Use list command to see available"
        exit 1
      }
      cd "$dir"
      for vol in $VOLUMES; do
        [ -f "$vol.tar" ] || { echo "Backup $backupname has no $vol.tar; not sealing it"; exit 1; }
      done
      # Written beside the final name and renamed, so a half-written manifest
      # never counts
      {
        echo "# homy backup manifest: every file below was complete when it was written"
        echo "sealed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "services=$mode"
        for f in *; do
          case "$f" in COMPLETE|*.partial) continue ;; esac
          [ -f "$f" ] || continue
          printf 'file=%s\t%s\t%s\n' "$f" "$(stat -c %s "$f")" "$(date -u -r "$f" +%Y-%m-%dT%H:%M:%SZ)"
        done
      } > COMPLETE.partial
      mv COMPLETE.partial COMPLETE
      echo "Sealed backup $backupname"
    )
    ;;
  list)
    (
      cd $BACKUP_ROOT
      ls -d * | while read i; do
        echo -n $i
        echo -en '\t'
        printf "%5.5s" `du -hs $i | cut -f1`
        echo -en '\t'
        if [ -f "$i/COMPLETE" ]; then echo -n "complete  "; else echo -n "INCOMPLETE"; fi
        echo -en '\t'
        n=0
        for t in "$i"/*.tar; do [ -f "$t" ] && n=$((n + 1)); done
        echo "$n volumes"
      done
    )
    ;;
  help)
    help
    ;;
  *)
    echo "Invalid command $cmd"
    help
    ;;
esac
