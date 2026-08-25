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
executa o seed idempotente de planos e confirma a estrutura do banco. Em seguida,
executa as validações estáticas abaixo para impedir drift de schema.

```bash
pnpm --filter @workspace/db run check
pnpm --filter @workspace/db run validate-coverage
pnpm --filter @workspace/db run validate-columns
pnpm --filter @workspace/db run validate-tables
pnpm --filter @workspace/db run verify-db
```

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
pnpm --filter @workspace/db run verify-db
```

Execute os testes do pacote alterado em lotes quando a suite for grande.