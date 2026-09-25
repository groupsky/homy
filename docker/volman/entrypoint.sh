#!/bin/bash

set -e

function help {
  echo "Available commands:"
  echo "  backup [volumes...] - backup volumes, defaults to all"
  echo "  restore <backup name> [volumes...] - restore from backup with name (latest points to last one)"
  echo "  store <backup name> <file> - save stdin as <file> inside an existing backup (used for database dumps)"
  echo "  list - show backup names"
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
  list)
    (
      cd $BACKUP_ROOT
      ls -d * | while read i; do
        echo -n $i
        echo -en '\t'
        printf "%5.5s\n" `du -hs $i | cut -f1`
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
