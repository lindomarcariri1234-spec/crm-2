import {
  BookOpen,
  Database,
  FileImage,
  Images,
  Info,
  Link2,
  ListChecks,
  Pencil,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  Unlink2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AccommodationHelp() {
  return (
    <Card data-testid="panel-hospedagens-help" className="overflow-hidden border-primary/15">
      <CardHeader className="pb-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-primary/10 p-2 text-primary">
            <BookOpen className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <CardTitle className="text-base">Como usar o cadastro de hospedagens</CardTitle>
            <CardDescription className="mt-1">
              Uma orientação rápida para manter a base de acomodações útil sem confundi-la com reservas ou inventário hoteleiro.
            </CardDescription>
          </div>
        </div>
        <details open className="group mt-4">
          <summary
            data-testid="button-toggle-hospedagens-help"
            className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
            <span>Ver orientação completa</span>
            <span className="ml-auto text-xs text-muted-foreground group-open:hidden">Abrir</span>
            <span className="ml-auto hidden text-xs text-muted-foreground group-open:inline">Recolher</span>
          </summary>

          <CardContent className="px-0 pb-0 pt-5">
            <div className="grid gap-4 lg:grid-cols-2">
              <section data-testid="help-hospedagens-objective" className="rounded-lg bg-muted/40 p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Database className="h-4 w-4 text-primary" aria-hidden="true" />
                  Objetivo
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Mantenha aqui uma base organizada de hotéis, pousadas e outras acomodações parceiras para consulta operacional e comercial da agência.
                  É um cadastro de referência: ele não cria uma reserva, não bloqueia quartos e não informa disponibilidade.
                </p>
              </section>

              <section data-testid="help-hospedagens-fields" className="rounded-lg border p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ListChecks className="h-4 w-4 text-primary" aria-hidden="true" />
                  Campos e comportamento
                </h2>
                <dl className="mt-3 space-y-2.5 text-sm leading-5">
                  <div>
                    <dt className="font-medium">Nome e tipo</dt>
                    <dd className="text-muted-foreground">Identificam a acomodação; são obrigatórios na criação. O tipo não aparece para alteração na edição atual.</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Endereço, cidade e UF</dt>
                    <dd className="text-muted-foreground">Localizam o parceiro. São informados na criação; a edição atual não os disponibiliza para alteração.</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Contato, telefone e e-mail</dt>
                    <dd className="text-muted-foreground">Guardam o contato operacional informado no cadastro; também ficam fora do formulário de edição atual.</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Quartos e diária</dt>
                    <dd className="text-muted-foreground">São referências comerciais opcionais e podem ser ajustadas na edição. Não representam estoque nem tarifa dinâmica.</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Comodidades e galeria</dt>
                    <dd className="text-muted-foreground">Comodidades são selecionadas na criação. A galeria aceita até 10 imagens de até 8 MB e pode ser mantida na edição.</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Status e avaliação</dt>
                    <dd className="text-muted-foreground">Ativo/inativo pode ser alterado na edição. A avaliação só é exibida quando existe e não é editada neste formulário.</dd>
                  </div>
                </dl>
              </section>

              <section data-testid="help-hospedagens-actions" className="rounded-lg border p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ListChecks className="h-4 w-4 text-primary" aria-hidden="true" />
                  Ações disponíveis
                </h2>
                <ul className="mt-3 space-y-2 text-sm leading-5 text-muted-foreground">
                  <li className="flex gap-2"><Search className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span><strong className="text-foreground">Pesquisar:</strong> filtre por nome, cidade ou tipo.</span></li>
                  <li className="flex gap-2"><BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span><strong className="text-foreground">Criar:</strong> use “Nova Hospedagem” e preencha ao menos nome e tipo.</span></li>
                  <li className="flex gap-2"><Pencil className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span><strong className="text-foreground">Editar:</strong> ajuste nome, quartos, diária, status e galeria conforme os campos disponíveis.</span></li>
                  <li className="flex gap-2"><Power className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span><strong className="text-foreground">Ativar ou inativar:</strong> altere o status na edição para indicar se o cadastro está em uso.</span></li>
                  <li className="flex gap-2"><Images className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span><strong className="text-foreground">Fotos:</strong> abra a galeria na tabela e use os controles para navegar pelas imagens.</span></li>
                  <li className="flex gap-2"><Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span><strong className="text-foreground">Excluir:</strong> confirme a exclusão somente depois de verificar se o registro não será mais consultado.</span></li>
                  <li className="flex gap-2"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span><strong className="text-foreground">Tentar novamente:</strong> se a listagem falhar, repita o carregamento pelo botão exibido na tabela.</span></li>
                </ul>
              </section>

              <section data-testid="help-hospedagens-workflow" className="rounded-lg bg-muted/40 p-4">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4 text-primary" aria-hidden="true" />
                  Fluxo recomendado
                </h2>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-5 text-muted-foreground">
                  <li>Cadastre o parceiro depois de confirmar o nome, tipo, localização e um contato de referência.</li>
                  <li>Inclua quartos, diária, comodidades e fotos apenas como informação de apoio para a equipe.</li>
                  <li>Revise os dados antes de salvar e mantenha o cadastro ativo somente enquanto ele for útil para a operação.</li>
                  <li>Prefira inativar quando o histórico ainda puder ser consultado; exclua apenas duplicidades ou registros que não devam permanecer.</li>
                  <li>Atualize o cadastro quando o parceiro mudar seus dados e confirme a galeria antes de remover fotos.</li>
                </ol>
              </section>

              <section data-testid="help-hospedagens-linked" className="rounded-lg border p-4 lg:col-span-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  Vinculado a
                </h2>
                <div className="mt-3 grid gap-3 text-sm leading-5 md:grid-cols-2">
                  <div className="flex gap-2">
                    <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
                    <p className="text-muted-foreground">
                      <strong className="text-foreground">Vínculos efetivos:</strong> a hospedagem pertence à agência/tenant, respeita as permissões do módulo, fica isolada dos dados de outras agências e participa do backup/exportação e importação. O cadastro mantém as referências da capa e da galeria; os arquivos de imagem são ativos de armazenamento separados.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Unlink2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                    <p className="text-muted-foreground">
                      <strong className="text-foreground">Não está vinculado atualmente:</strong> viagem, destino, fornecedor, reserva, produto da loja, checkout, disponibilidade de quartos ou qualquer integração hoteleira/PMS/OTA. Custos de viagem e despesas são módulos separados.
                    </p>
                  </div>
                </div>
                <div data-testid="help-hospedagens-not-integrated" className="mt-4 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm leading-5 text-muted-foreground">
                  <FileImage className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
                  <p>
                    <strong className="text-foreground">Importante:</strong> salvar uma diária ou uma quantidade de quartos não reserva capacidade. Para uma contratação real, a equipe ainda precisa confirmar disponibilidade e condições diretamente com o parceiro.
                  </p>
                </div>
              </section>
            </div>
          </CardContent>
        </details>
      </CardHeader>
    </Card>
  );
}