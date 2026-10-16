#!/usr/bin/env bash
set -Eeuo pipefail

# Deliberately support only reviewed suites. This runner never accepts a
# DATABASE_URL, PostgreSQL target, or arbitrary Vitest path from the caller.
# Cleanup audit for the allowlist:
# - client-dream-destinations: afterAll removes both test users; tenant
#   deletion cascades to clients and destinations, then the pool is closed.
# - dashboard-summary: afterAll deletes fixture tenants and closes the pool.
# - trips-filter: afterAll removes product/store/trip fixtures, then tenants,
#   and closes the pool.
# - reservation-boarding-point: afterAll deletes reservations, boarding
#   locations, clients, trip, user, and tenant in dependency order.
# Suites with hard-coded database names (for example WhatsApp media retention
# and gratuity races) are intentionally excluded; this runner's approved name
# is fixed below and is verified against both loopback and the temporary cluster.
readonly API_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly REPO_ROOT="$(cd -- "$API_DIR/../.." && pwd)"
readonly DATABASE_NAME="visitecrm_local_integration_test"

die() {
  printf 'Erro: %s\n' "$*" >&2
  exit 2
}

usage() {
  cat <<'EOF'
Uso: pnpm --filter @workspace/api-server test:integration:local -- <suíte...>

Suítes locais revisadas:
  client-dream-destinations
  dashboard-summary
  trips-filter
  reservation-boarding-point
  all

Cada execução cria PostgreSQL e um banco temporários, aplica as migrações,
executa somente as suítes escolhidas e remove o cluster ao terminar.
EOF
}

declare -A SUITE_FILES=(
  [client-dream-destinations]="src/__tests__/client-dream-destinations.integration.test.ts"
  [dashboard-summary]="src/__tests__/dashboard-summary.integration.test.ts"
  [trips-filter]="src/__tests__/trips-filter.integration.test.ts"
  [reservation-boarding-point]="src/__tests__/reservation-boarding-point-roundtrip.integration.test.ts"
)

if [[ "${1:-}" == "--" ]]; then shift; fi
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if [[ "${1:-}" == "--list" ]]; then
  printf '%s\n' "${!SUITE_FILES[@]}" all | sort
  exit 0
fi
(( $# > 0 )) || { usage >&2; die "informe ao menos uma suíte revisada"; }

declare -a FILES=()
declare -A SELECTED=()
for suite in "$@"; do
  if [[ "$suite" == "all" ]]; then
    for allowed in "${!SUITE_FILES[@]}"; do SELECTED["$allowed"]=1; done
  elif [[ -n "${SUITE_FILES[$suite]:-}" ]]; then
    SELECTED["$suite"]=1
  else
    die "suíte não permitida: $suite (use --list para ver as opções)"
  fi
done
for suite in "${!SELECTED[@]}"; do FILES+=("${SUITE_FILES[$suite]}"); done
IFS=$'\n' FILES=($(printf '%s\n' "${FILES[@]}" | sort))
unset IFS

for tool in initdb pg_ctl createdb psql node pnpm; do
  command -v "$tool" >/dev/null 2>&1 || die "comando obrigatório ausente: $tool"
done

# Ignore any inherited PostgreSQL routing settings. The only database URL
# introduced below is built for the cluster created inside this script.
unset DATABASE_URL PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE

TEMP_PARENT="${TMPDIR:-/tmp}"
TEMP_DIR="$(mktemp -d "$TEMP_PARENT/visitecrm-pg-local.XXXXXX")"
case "$TEMP_DIR" in
  "$TEMP_PARENT"/visitecrm-pg-local.*) ;;
  *) die "diretório temporário inesperado; recusando iniciar" ;;
esac
readonly TEMP_DIR
readonly PGDATA="$TEMP_DIR/data"
readonly PGLOG="$TEMP_DIR/postgres.log"
readonly PORT="$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
readonly PG_BIN_DIR="$(dirname -- "$(command -v initdb)")"
readonly PG_CTL="$PG_BIN_DIR/pg_ctl"
readonly CREATEDB="$PG_BIN_DIR/createdb"
readonly PSQL="$PG_BIN_DIR/psql"

cleanup() {
  if [[ -f "$PGDATA/postmaster.pid" ]]; then
    "$PG_CTL" -D "$PGDATA" -m immediate stop >/dev/null 2>&1 || true
  fi
  case "$TEMP_DIR" in
    "$TEMP_PARENT"/visitecrm-pg-local.*) rm -rf -- "$TEMP_DIR" ;;
    *) printf 'Aviso: preservando diretório temporário inesperado: %s\n' "$TEMP_DIR" >&2 ;;
  esac
}
trap cleanup EXIT

initdb --username=postgres --auth-local=trust --auth-host=trust --no-instructions --encoding=UTF8 --no-locale -D "$PGDATA" >/dev/null
"$PG_CTL" -D "$PGDATA" \
  -o "-h 127.0.0.1 -k \"$TEMP_DIR\" -p $PORT -c listen_addresses=127.0.0.1" \
  -l "$PGLOG" -w start >/dev/null
"$CREATEDB" -h 127.0.0.1 -p "$PORT" -U postgres "$DATABASE_NAME"

LOCAL_DATABASE_URL="postgresql://postgres@127.0.0.1:$PORT/$DATABASE_NAME"
export DATABASE_URL="$LOCAL_DATABASE_URL"

# Confirm the selected DB is the one in the private temporary cluster before
# any migration or test is allowed to write to it.
IDENTITY="$("$PSQL" -X -h 127.0.0.1 -p "$PORT" -U postgres -d "$DATABASE_NAME" -At -F '|' \
  -c "SELECT current_database(), current_setting('data_directory'), inet_server_addr()")"
IFS='|' read -r ACTUAL_DATABASE ACTUAL_DATA_DIR ACTUAL_HOST <<< "$IDENTITY"
[[ "$ACTUAL_DATABASE" == "$DATABASE_NAME" ]] || die "nome de banco fora da lista aprovada"
[[ "$(realpath -- "$ACTUAL_DATA_DIR")" == "$(realpath -- "$PGDATA")" ]] || die "o banco não pertence ao cluster temporário"
[[ "$ACTUAL_HOST" == "127.0.0.1" ]] || die "o servidor PostgreSQL não está em loopback"

printf 'Preparando banco temporário local para: %s\n' "${FILES[*]}"
cd "$REPO_ROOT"
pnpm --filter @workspace/db run migrate
pnpm --filter @workspace/api-server exec vitest run --config vitest.integration.config.ts "${FILES[@]}"
