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
   pnpm --filter @workspace/db validate-coverage
   pnpm --filter @workspace/db validate-columns
   pnpm --filter @workspace/db validate-tables
   ```

Não execute alterações destrutivas em produção sem confirmação explícita.

## Validação recomendada

```bash
pnpm --filter @workspace/visitecrm run typecheck
pnpm --filter @workspace/visitecrm run build
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/cliente-app run typecheck
pnpm --filter @workspace/guide-app run typecheck
```

Execute os testes do pacote alterado em lotes quando a suite for grande.