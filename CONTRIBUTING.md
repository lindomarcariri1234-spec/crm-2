# Contribuindo

## Antes de abrir uma alteração

- Use `pnpm`; não misture `npm`, `yarn` ou lockfiles adicionais.
- Mantenha mudanças pequenas, tipadas e cobertas por testes.
- Não coloque segredos, chaves ou dados de produção no repositório.
- Para mudanças que afetam a API, execute também o build de produção do servidor.

## Alterações no banco de dados

O arquivo `lib/db/drizzle/0000_squash_baseline.sql` é histórico e **nunca deve ser alterado**. Toda evolução de schema deve usar uma migração incremental nova:

1. Atualize o schema Drizzle em `lib/db/src/schema`.
2. Crie uma migration SQL com timestamp maior que o último registro existente.
3. Registre a migration em `lib/db/drizzle/meta/_journal.json`.
4. Revise a migration para garantir que ela seja segura para bancos já existentes; não exclua ou reescreva dados sem aprovação explícita.
5. Aplique localmente com `pnpm --filter @workspace/db migrate`.
6. Valide com:

   ```bash
   pnpm --filter @workspace/db check
   pnpm --filter @workspace/db validate-coverage # audita colunas pós-baseline
   pnpm --filter @workspace/db validate-columns
   pnpm --filter @workspace/db validate-tables
   ```

Não execute alterações destrutivas em produção sem confirmação explícita.

## Validação recomendada

O hook automático `scripts/post-merge.sh` instala exatamente as dependências
registradas no lockfile (`pnpm install --frozen-lockfile`), aplica migrations,
executa o seed idempotente de planos e roda a verificação local unificada
`schema-drift`. Ela confirma a estrutura do banco diretamente por
`information_schema`, sem depender do endpoint interno de database diff do
Replit.

```bash
pnpm --filter @workspace/db run schema-drift
```

Para validar somente os arquivos de migration, sem um banco provisionado:

```bash
pnpm --filter @workspace/db run schema-drift -- --static-only
```

O modo padrão exige `DATABASE_URL` e executa os checks estáticos antes da
comparação live. `--live-only` executa somente a comparação com o banco ativo.
Os códigos de saída são: `1` para falha estática, `2` para
`DATABASE_URL` ausente, `3` para banco inacessível ou consulta interrompida e
`4` para divergência encontrada entre o snapshot e o banco. Assim, uma falha
de configuração ou conexão não é confundida com drift real.

O workflow local `schema-drift` e o pós-merge usam somente essa entrada
reproduzível. A mensagem `Failed to check for database diff: The endpoint has
been disabled` pertence à integração de plataforma do Replit; habilitar esse
endpoint é uma configuração do control plane, não uma correção de código.

Antes de abrir uma alteração, execute a validação completa:

```bash
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run check
pnpm --filter @workspace/db run validate-coverage
pnpm --filter @workspace/db run validate-columns
pnpm --filter @workspace/db run validate-tables
pnpm run build
pnpm test
```

Para alterações de banco, aplique a migration localmente conforme a seção acima e,
quando houver um banco de desenvolvimento disponível, execute também:

```bash
pnpm --filter @workspace/db run schema-drift
```

Execute os testes do pacote alterado em lotes quando a suite for grande.

## Finalizar uma Task com commit e push

O comando abaixo cria um commit com **somente os arquivos já adicionados ao
stage** e o envia ao branch atual no remoto `origin`:

```bash
git status
git add caminho/do/arquivo
pnpm task:finish -- "feat: descrição curta da Task"
```

O comando exige uma mensagem não vazia, um branch com upstream exatamente em
`origin/<branch>`, alterações staged e uma cópia local que já contenha o
histórico remoto mais recente. Ele mostra os arquivos staged antes do commit,
nunca usa `--force` e não cria commits vazios.

Se houver alterações não staged ou arquivos ainda não rastreados, revise-os e
deixe no stage apenas o que deve ser enviado:

```bash
git diff
git add caminho/do/arquivo
```

Se o remoto tiver avançado ou os históricos divergirem, atualize e reconcilie
manualmente o branch (por exemplo, com `git pull --rebase` quando apropriado),
revise o resultado e rode o comando novamente. O comando não faz merge,
rebase, resolução de conflitos ou force push automaticamente.

Se o push falhar por acesso, rede ou uma atualização concorrente, o commit
local permanece preservado. Corrija a causa e repita:

```bash
git push origin "$(git branch --show-current)"
```

Para validar o comando sem criar commits neste repositório nem usar o remoto
real, execute:

```bash
pnpm task:finish:test
```