#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMMAND=(bash "$ROOT_DIR/scripts/task-finish.sh")
TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

fail() {
  printf 'task:finish:test: %s\n' "$*" >&2
  exit 1
}

expect_failure() {
  local expected=$1
  shift
  if "$@" >"$TMP_DIR/output" 2>&1; then
    fail "o comando deveria falhar: $*"
  fi
  grep -Fq "$expected" "$TMP_DIR/output" ||
    fail "a falha não explicou '$expected'"
}

new_repo() {
  local name=$1
  local remote="$TMP_DIR/$name-origin.git"
  local work="$TMP_DIR/$name-work"

  git init --bare -q "$remote"
  git init -q "$work"
  (
    cd "$work"
    git config user.name "Task Finish Test"
    git config user.email "task-finish-test@example.invalid"
    printf 'base\n' > README.md
    git add README.md
    git commit -qm "base"
    git branch -M main
    git remote add origin "$remote"
    git push -qu origin main
    git branch --set-upstream-to=origin/main main >/dev/null
  )
  printf '%s\n' "$work"
}

work=$(new_repo happy)
(
  cd "$work"
  expect_failure "Uso:" "${COMMAND[@]}" --
  expect_failure "mensagem do commit não pode estar vazia" "${COMMAND[@]}" -- "   "

  printf 'happy\n' > feature.txt
  git add feature.txt
  "${COMMAND[@]}" -- "test: publish staged work"
  [[ "$(git log -1 --format=%s)" == "test: publish staged work" ]] ||
    fail "o caminho feliz não criou o commit esperado"
  [[ "$(git rev-parse HEAD)" == "$(git --git-dir="$TMP_DIR/happy-origin.git" rev-parse main)" ]] ||
    fail "o caminho feliz não enviou o commit ao origin"

  expect_failure "não há alterações staged" "${COMMAND[@]}" -- "test: empty"

  printf 'unstaged\n' > unstaged.txt
  expect_failure "alterações não staged" "${COMMAND[@]}" -- "test: unstaged"
  rm unstaged.txt

  git checkout -qb without-upstream
  printf 'branch\n' > branch.txt
  git add branch.txt
  expect_failure "não possui upstream" "${COMMAND[@]}" -- "test: no upstream"
  git reset --hard -q
  git checkout -q main
)

divergent=$(new_repo divergent)
(
  git clone -q "$TMP_DIR/divergent-origin.git" "$TMP_DIR/divergent-other"
  cd "$TMP_DIR/divergent-other"
  git config user.name "Remote Writer"
  git config user.email "remote-writer@example.invalid"
  printf 'remote\n' > remote.txt
  git add remote.txt
  git commit -qm "remote advance"
  git push -qu origin main
)
(
  cd "$divergent"
  before=$(git rev-parse HEAD)
  printf 'local\n' > local.txt
  git add local.txt
  expect_failure "o remoto possui alterações" "${COMMAND[@]}" -- "test: divergent"
  [[ "$(git rev-parse HEAD)" == "$before" ]] ||
    fail "o cenário divergente criou commit antes da proteção"
)

rejected=$(new_repo rejected)
cat > "$TMP_DIR/rejected-origin.git/hooks/pre-receive" <<'EOF'
#!/usr/bin/env bash
exit 1
EOF
chmod +x "$TMP_DIR/rejected-origin.git/hooks/pre-receive"
(
  cd "$rejected"
  printf 'rejected\n' > rejected.txt
  git add rejected.txt
  expect_failure "commit local foi preservado" "${COMMAND[@]}" -- "test: rejected push"
  [[ "$(git rev-parse HEAD)" != "$(git --git-dir="$TMP_DIR/rejected-origin.git" rev-parse main)" ]] ||
    fail "o push rejeitado não preservou um commit local pendente"
)

no_origin=$(new_repo no-origin)
(
  cd "$no_origin"
  git remote remove origin
  printf 'no origin\n' > no-origin.txt
  git add no-origin.txt
  expect_failure "remoto 'origin' não está configurado" "${COMMAND[@]}" -- "test: missing origin"
)

printf 'task:finish:test: todos os cenários passaram.\n'