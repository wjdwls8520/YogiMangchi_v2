#!/usr/bin/env bash
# YogiMangchi V2 - $0 Automated Daily PostgreSQL Backup Script
#
# Executes pg_dump inside the running Docker PostgreSQL container, compresses
# with gzip, validates archive integrity and dump payload, and prunes archives
# older than RETENTION_DAYS.
#
# Example EC2 crontab (daily at 04:00 KST; uses UTC 19:00 if host TZ is UTC):
#   0 4 * * * TZ=Asia/Seoul POSTGRES_USER=yogimangchi /opt/yogimangchi/infra/postgres/backup.sh >> /var/log/yogimangchi-pg-backup.log 2>&1
#
# Isolated restore verification (OPS-06; NEVER run against live production DB):
#   gunzip -c /path/to/yogimangchi_YYYYMMDD_HHMMSS.sql.gz | docker exec -i yogimangchi-postgres psql -U "$POSTGRES_USER" -d yogimangchi_restore_test

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-yogimangchi-postgres}"
POSTGRES_DB="${POSTGRES_DB:-yogimangchi}"
POSTGRES_USER="${POSTGRES_USER:-${YOGIMANGCHI_DB_USERNAME:-yogimangchi}}"
BACKUP_DIR="${BACKUP_DIR:-${SCRIPT_DIR}/backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"

TIMESTAMP="$(date '+%Y%m%d_%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/${POSTGRES_DB}_${TIMESTAMP}.sql.gz"
TMP_FILE="${BACKUP_FILE}.tmp"

log() {
    printf '[%s] [pg-backup] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*"
}

fail() {
    printf '[%s] [pg-backup] ERROR: %s\n' "$(date '+%Y-%m-%dT%H:%M:%S%z')" "$*" >&2
    exit 1
}

cleanup() {
    if [[ -f "${TMP_FILE}" ]]; then
        rm -f "${TMP_FILE}"
    fi
}
trap cleanup EXIT

command -v docker >/dev/null 2>&1 || fail "docker CLI is required"
command -v gzip >/dev/null 2>&1 || fail "gzip is required"

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
    fail "RETENTION_DAYS must be a non-negative integer (got '${RETENTION_DAYS}')"
fi

if [[ -z "${POSTGRES_USER}" || -z "${POSTGRES_DB}" || -z "${POSTGRES_CONTAINER}" ]]; then
    fail "POSTGRES_CONTAINER, POSTGRES_DB, and POSTGRES_USER must be non-empty"
fi

CONTAINER_RUNNING="$(docker inspect -f '{{.State.Running}}' "${POSTGRES_CONTAINER}" 2>/dev/null || echo 'false')"
if [[ "${CONTAINER_RUNNING}" != "true" ]]; then
    fail "PostgreSQL container '${POSTGRES_CONTAINER}' is not running"
fi

mkdir -p "${BACKUP_DIR}"

log "Starting backup: container=${POSTGRES_CONTAINER} db=${POSTGRES_DB} user=${POSTGRES_USER} target=${BACKUP_FILE}"

docker exec "${POSTGRES_CONTAINER}" \
    pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner --no-acl --clean --if-exists \
    | gzip -9 > "${TMP_FILE}"

if [[ ! -s "${TMP_FILE}" ]]; then
    fail "Backup archive is empty: ${TMP_FILE}"
fi

if ! gzip -t "${TMP_FILE}"; then
    fail "Backup archive failed gzip integrity verification: ${TMP_FILE}"
fi

# Guard against a valid 20-byte empty gzip stream (no actual SQL payload).
# Disable pipefail inside subshell so SIGPIPE from head/grep does not false-fail.
if ! ( set +o pipefail; gzip -dc "${TMP_FILE}" 2>/dev/null | head -c 4096 | grep -q "PostgreSQL database dump" ); then
    fail "Backup archive does not contain a valid PostgreSQL dump header"
fi

mv -f "${TMP_FILE}" "${BACKUP_FILE}"

BACKUP_BYTES="$(wc -c < "${BACKUP_FILE}" | tr -d '[:space:]')"
log "Backup verified and saved: file=${BACKUP_FILE} bytes=${BACKUP_BYTES}"

PRUNED_COUNT=0
while IFS= read -r old_file; do
    [[ -n "${old_file}" ]] || continue
    rm -f "${old_file}"
    PRUNED_COUNT=$((PRUNED_COUNT + 1))
    log "Pruned expired backup: ${old_file}"
done < <(find "${BACKUP_DIR}" -maxdepth 1 -type f -name "${POSTGRES_DB}_*.sql.gz" -mtime +"${RETENTION_DAYS}" 2>/dev/null)

log "Backup complete: retention_days=${RETENTION_DAYS} pruned=${PRUNED_COUNT}"
