#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'task:finish: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
Uso: pnpm task:finish -- "Mensagem do commit"

Antes de executar, revise e adicione ao stage apenas os arquivos que devem
entrar no commit. O comando recusa alterações não staged e não usa force push.
EOF
  exit 1
}

if [[ "${1:-}" == "--" ]]; then
  shift
fi

[[ $# -eq 1 ]] || usage
message=$1
[[ -n "${message//[[:space:]]/}" ]] || fail "a mensagem do commit não pode estar vazia."

git rev-parse --is-inside-work-tree >/dev/null 2>&1 ||
  fail "execute este comando dentro de um repositório Git."

branch=$(git symbolic-ref --quiet --short HEAD) ||
  fail "HEAD está destacado; faça checkout de um branch antes de continuar."

git remote get-url origin >/dev/null 2>&1 ||
  fail "o remoto 'origin' não está configurado. Configure-o e tente novamente."

upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null) ||
  fail "o branch '$branch' não possui upstream. Configure 'origin/$branch' e tente novamente."
[[ "$upstream" == "origin/$branch" ]] ||
  fail "o upstream de '$branch' é '$upstream', não 'origin/$branch'. Ajuste o upstream antes de continuar."

if git diff --quiet; then
  :
else
  fail "há alterações não staged. Revise-as e use 'git add <arquivos>' antes de executar."
fi

if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  fail "há alterações não staged ou arquivos não rastreados. Revise-os e use 'git add <arquivos>' antes de executar."
fi

if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  fail "há conflitos não resolvidos. Resolva-os e adicione os arquivos antes de executar."
fi

if git diff --cached --quiet; then
  fail "não há alterações staged para registrar. Adicione os arquivos pretendidos com 'git add'."
fi

# Refresh the exact tracking ref before committing. This catches both a remote
# that advanced and a branch whose histories diverged, without printing a
# credential-bearing remote URL.
git fetch --quiet origin "refs/heads/$branch:refs/remotes/origin/$branch" ||
  fail "não foi possível atualizar 'origin/$branch'. Verifique rede, acesso e a existência do branch remoto."

if ! git merge-base --is-ancestor "$upstream" HEAD; then
  fail "o remoto possui alterações que este branch não contém. Atualize e reconcilie o histórico antes de tentar novamente."
fi

printf 'Arquivos staged que serão enviados:\n'
git diff --cached --name-status

git commit -m "$message"

if git push origin "HEAD:refs/heads/$branch"; then
  printf "task:finish: commit criado e enviado para origin/%s.\n" "$branch"
else
  cat >&2 <<EOF
task:finish: o commit local foi preservado, mas o push falhou.
Verifique autenticação ou a divergência remota e tente novamente com:
  git push origin $branch
EOF
  exit 1
fi