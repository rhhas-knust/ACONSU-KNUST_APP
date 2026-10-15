#!/usr/bin/env bash
# A copy of the whole ACONSU database, including every uploaded photo and PDF,
# saved to a file on THIS computer.
#
#   MONGODB_URI='mongodb+srv://...' ./scripts/backup.sh [folder]
#
# The folder defaults to ~/aconsu-backups. Set BACKUP_PASSPHRASE to have the
# copy locked with a passphrase too (AES-256); without it the file is readable
# by anyone who gets hold of it, and it holds every member's details.
#
# Needs `mongodump`, from MongoDB's free Database Tools:
#   https://www.mongodb.com/try/download/database-tools
# See docs/operations.md for how often to run it and how to restore from it.
set -euo pipefail

: "${MONGODB_URI:?Set MONGODB_URI to the same connection string the app uses}"
command -v mongodump >/dev/null 2>&1 || {
  echo "mongodump is not installed. Get MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools" >&2
  exit 1
}

dest="${1:-$HOME/aconsu-backups}"

# A database copy holds personal details. It must never end up in a repository.
# The check looks at the nearest folder that already exists, so a refusal does
# not leave an empty folder behind inside the repository either.
probe="$dest"
while [ ! -d "$probe" ] && [ "$probe" != "/" ] && [ "$probe" != "." ]; do probe="$(dirname "$probe")"; done
if git -C "$probe" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Refusing to save a database copy inside a git repository ($dest). Choose a folder outside it." >&2
  exit 1
fi
mkdir -p "$dest"

stamp="$(date +%Y-%m-%d-%H%M)"
file="$dest/aconsu-$stamp.archive.gz"

mongodump --uri="$MONGODB_URI" --gzip --archive="$file" --quiet
chmod 600 "$file"

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  command -v openssl >/dev/null 2>&1 || { echo "openssl is needed to lock the copy with a passphrase" >&2; exit 1; }
  openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:BACKUP_PASSPHRASE -in "$file" -out "$file.enc"
  chmod 600 "$file.enc"
  rm -f "$file"
  file="$file.enc"
fi

# Copies older than 60 days are removed, so the folder does not fill the disk.
find "$dest" -maxdepth 1 -name 'aconsu-*.archive.gz*' -mtime +60 -delete 2>/dev/null || true

echo "Saved $file ($(du -h "$file" | cut -f1))"
