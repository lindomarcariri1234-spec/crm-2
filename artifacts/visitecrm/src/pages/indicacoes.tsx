ilModalOpen(false); openPayBonusDialog(selectedReferral); }}
                className="bg-green-600 hover:bg-green-700"
              >
                <Wallet className="w-4 h-4 mr-2" />
                Pagar Bônus
              </Button>
            )}
            {selectedReferral && selectedReferral.status === REFERRAL_STATUS.COMPLETED && (me?.role === ROLES.AGENCY_ADMIN || me?.role === ROLES.AGENCY_MANAGER || me?.role === ROLES.SUPER_ADMIN) && (
              <Button
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-50"
                onClick={() => { setDetailModalOpen(false); openReverseBonusDialog(selectedReferral); }}
              >
                <XCircle className="w-4 h-4 mr-2" />
                Reverter bônus
              </Button>
            )}
            <Button variant="outline" onClick={() => setDetailModalOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Modal */}
      <Dialog open={settingsModalOpen} onOpenChange={setSettingsModalOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Configurações do Programa de Indicações</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">

            {/* Ativação do Programa */}
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ativação do Programa</p>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Programa ativo</Label>
                  <p className="text-xs text-muted-foreground">Ativar ou desativar o programa de indicações</p>
                </div>
                <Switch
                  checked={localSettings.isEnabled ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, isEnabled: v }))}
                />
              </div>
            </div>

            {/* Benefícios para o Indicado */}
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Benefícios para o Indicado</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tipo de desconto</Label>
                  <Select
                    value={localSettings.discountType ?? "percentage"}
                    onValueChange={(v) => setLocalSettings((s) => ({ ...s, discountType: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percentage">Percentual (%)</SelectItem>
                      <SelectItem value="fixed">Valor fixo (R$)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>
                    {localSettings.discountType === "fixed" ? "Desconto (R$)" : "Desconto (%)"}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={localSettings.discountValue ?? "5.00"}
                    onChange={(e) => setLocalSettings((s) => ({ ...s, discountValue: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Validade do benefício para o indicado (dias)</Label>
                <Input
                  type="number"
                  value={(localSettings as Record<string, unknown>).discountExpirationDays as number ?? 30}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), discountExpirationDays: parseInt(e.target.value) || 30 } as typeof s))}
                />
                <p className="text-xs text-muted-foreground">Por quantos dias o desconto gerado pelo código permanece válido após ser aplicado.</p>
              </div>
            </div>

            {/* Recompensa para o Indicador */}
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recompensa para o Indicador</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Tipo de bônus</Label>
                  <Select
                    value={localSettings.bonusType ?? "credit"}
                    onValueChange={(v) => setLocalSettings((s) => ({ ...s, bonusType: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="credit">Cashback</SelectItem>
                      <SelectItem value="cash">Dinheiro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Bônus (R$)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={localSettings.bonusValue ?? "10.00"}
                    onChange={(e) => setLocalSettings((s) => ({ ...s, bonusValue: e.target.value }))}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Período de carência do bônus (dias)</Label>
                <Input
                  type="number"
                  min="0"
                  value={(localSettings as Record<string, unknown>).gracePeriodDays as number ?? 30}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), gracePeriodDays: Math.max(0, parseInt(e.target.value) || 0) } as typeof s))}
                />
                <p className="text-xs text-muted-foreground">Quantos dias após a conversão o bônus fica retido antes de ser liberado ao indicador. O bônus é revertido automaticamente se a reserva ou excursão for cancelada nesse período.</p>
              </div>
              <div className="space-y-1">
                <Label>Validade do cashback/bônus do indicador (dias)</Label>
                <Input
                  type="number"
                  min="0"
                  value={(localSettings as Record<string, unknown>).bonusValidityDays as number ?? 30}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), bonusValidityDays: Math.max(0, parseInt(e.target.value) || 0) } as typeof s))}
                />
                <p className="text-xs text-muted-foreground">Por quantos dias o bônus permanece válido para resgate após ser liberado ao indicador. Use 0 para não expirar.</p>
              </div>
            </div>

            {/* Elegibilidade e Limites */}
            <div className="border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Elegibilidade e Limites</p>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Exigir primeira compra</Label>
                  <p className="text-xs text-muted-foreground">Bônus só é liberado após a primeira compra do indicado</p>
                </div>
                <Switch
                  checked={localSettings.requireFirstPurchase ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, requireFirstPurchase: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Permitir auto-indicação</Label>
                  <p className="text-xs text-muted-foreground">Permite que alguém use seu próprio código</p>
                </div>
                <Switch
                  checked={localSettings.allowSelfReferral ?? false}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, allowSelfReferral: v }))}
                />
              </div>
              <div className="space-y-1">
                <Label>Valor mínimo de compra (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={String((localSettings as Record<string, unknown>).minPurchaseAmount ?? "")}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), minPurchaseAmount: e.target.value === "" ? null : e.target.value } as typeof s))}
                  placeholder="Sem mínimo"
                />
                <p className="text-xs text-muted-foreground">Valor mínimo do pedido para que o código de indicação seja aceito. Deixe em branco para não exigir.</p>
              </div>
              <div className="space-y-1">
                <Label>Máximo de indicações por indicador</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={String((localSettings as Record<string, unknown>).maxReferralsPerUser ?? 0)}
                  onChange={(e) => setLocalSettings((s) => ({ ...(s as object), maxReferralsPerUser: Math.max(0, parseInt(e.target.value) || 0) } as typeof s))}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">Número máximo de indicações que cada cliente pode fazer. Use 0 para ilimitado.</p>
              </div>
            </div>

            {/* Política de Códigos */}
            <div className="border rounded-lg p-3 space-y-3 bg-amber-50/60">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">Política de Códigos</p>
              <div className="space-y-1">
                <Label>Validade de indicação pendente (dias)</Label>
                <Input
                  type="number"
                  value={localSettings.expirationDays ?? 30}
                  onChange={(e) => setLocalSettings((s) => ({ ...s, expirationDays: parseInt(e.target.value) || 30 }))}
                />
                <p className="text-xs text-muted-foreground">Por quantos dias uma indicação pendente aguarda conversão antes de expirar.</p>
              </div>
              <div className="rounded-md bg-amber-100/70 border border-amber-200 p-3 text-xs text-amber-900 space-y-1">
                <p className="font-medium">Códigos são permanentes e gerenciados pela agência</p>
                <p>Cada cliente possui um código único, gerado automaticamente no cadastro. Os códigos não expiram e não podem ser alterados ou regenerados pelo cliente — apenas a agência pode ativar ou bloquear um código. Ao desativar ou bloquear um cliente, seu código de indicação é bloqueado automaticamente.</p>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Mensagem de compartilhamento</Label>
              <Input
                value={localSettings.shareMessage as string ?? ""}
                onChange={(e) => setLocalSettings((s) => ({ ...s, shareMessage: e.target.value }))}
                placeholder="Use meu código e ganhe desconto na sua viagem!"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs text-green-700 border-green-400 hover:bg-green-50"
                disabled={testWhatsApp.isPending}
                onClick={() => sendWhatsAppTest("share")}
              >
                {testWhatsApp.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <MessageCircle className="w-3 h-3 mr-1" />}
                Testar mensagem
              </Button>
              <p className="text-xs text-muted-foreground">
                Variáveis disponíveis:{" "}
                <code className="bg-muted px-1 rounded">{"{nome}"}</code> nome do indicador,{" "}
                <code className="bg-muted px-1 rounded">{"{codigo}"}</code> código de indicação,{" "}
                <code className="bg-muted px-1 rounded">{"{link}"}</code> link de indicação,{" "}
                <code className="bg-muted px-1 rounded">{"{bonus}"}</code> valor do bônus.{" "}
                Ex.: <em>Olá {"{nome}"}! Use o código <strong>{"{codigo}"}</strong> ou acesse {"{link}"} e ganhe {"{bonus}"}.</em>
              </p>
              {(localSettings.shareMessage as string)?.trim() && (
                <p className="text-xs text-muted-foreground bg-muted/50 border rounded px-2 py-1.5">
                  <span className="font-medium text-muted-foreground">Pré-visualização:</span>{" "}
                  {(localSettings.shareMessage as string)
                    .replace(/\{nome\}/g, "João")
                    .replace(/\{codigo\}/g, "JOAO123")
                    .replace(/\{link\}/g, "https://exemplo.com.br/ind/JOAO123")
                    .replace(/\{bonus\}/g, fmtCurrency(settings?.bonusValue ?? 10))}
                </p>
              )}
              {localSettings.whatsappEnabled && (localSettings.shareMessage as string)?.trim() && (
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {whatsappTestState.share?.success && (
                    <p className="text-[11px] text-green-600 flex items-center gap-1 mr-auto"><Check className="w-3 h-3" /> Enviado com sucesso!</p>
                  )}
                  {whatsappTestState.share?.error && (
                    <p className="text-[11px] text-red-500 flex items-center gap-1 mr-auto"><XCircle className="w-3 h-3" /> {whatsappTestState.share.error}</p>
                  )}
                  <button
                    type="button"
                    disabled={!!whatsappTestState.share?.loading}
                    onClick={() => void testWhatsappTemplate("share")}
                    className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {whatsappTestState.share?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Testar via WhatsApp
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-3 border rounded-lg p-3 bg-indigo-50/50">
              <Label className="flex items-center gap-1.5 font-semibold text-indigo-800">
                <span className="text-base">⭐</span>
                Pontos de fidelidade por indicação
              </Label>
              <div className="space-y-1">
                <Label className="text-xs">Pontos por indicação confirmada</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={String(localSettings.pointsPerReferral ?? 0)}
                  onChange={(e) => setLocalSettings((s) => ({ ...s, pointsPerReferral: Math.max(0, parseInt(e.target.value) || 0) }))}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  Quantos pontos de fidelidade o indicador ganha por indicação convertida. Use 0 para desativar.
                </p>
              </div>
            </div>

            <div className="space-y-3 border rounded-lg p-3 bg-amber-50/50">
              <Label className="flex items-center gap-1.5 font-semibold text-amber-800">
                <span className="text-base">⏰</span>
                Avisos de vencimento por e-mail
              </Label>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-normal">Aviso 7 dias antes</Label>
                  <p className="text-xs text-muted-foreground">Envia e-mail quando faltam 7 dias para o código vencer</p>
                </div>
                <Switch
                  checked={localSettings.expiryWarning7DaysEnabled ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, expiryWarning7DaysEnabled: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-normal">Aviso 1 dia antes</Label>
                  <p className="text-xs text-muted-foreground">Envia e-mail quando falta 1 dia para o código vencer</p>
                </div>
                <Switch
                  checked={localSettings.expiryWarning1DayEnabled ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, expiryWarning1DayEnabled: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-normal">Aviso de bônus liberado</Label>
                  <p className="text-xs text-muted-foreground">Envia e-mail ao indicador quando o período de carência de {(localSettings as Record<string, unknown>).gracePeriodDays != null ? Number((localSettings as Record<string, unknown>).gracePeriodDays) : (settings?.gracePeriodDays ?? 30)} dias expira e o bônus está disponível</p>
                </div>
                <Switch
                  checked={localSettings.bonusReleaseEmailEnabled ?? true}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, bonusReleaseEmailEnabled: v }))}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-normal">Pontos de fidelidade creditados</Label>
                  <p className="text-xs text-muted-foreground">Envia e-mail ao indicador quando pontos de fidelidade são creditados por uma indicação convertida</p>
                </div>
                <Switch
                  checked={(localSettings as Record<string, unknown>).loyaltyPointsEmailEnabled !== false}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, loyaltyPointsEmailEnabled: v }))}
                />
              </div>
            </div>

            <div className="space-y-3 border rounded-lg p-3 bg-green-50/50">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5 font-semibold text-green-800">
                  <Phone className="w-4 h-4" />
                  Notificações WhatsApp
                </Label>
                <Switch
                  checked={localSettings.whatsappEnabled ?? false}
                  onCheckedChange={(v) => setLocalSettings((s) => ({ ...s, whatsappEnabled: v }))}
                />
              </div>
              {localSettings.whatsappEnabled && (
                <>
                  <div className="space-y-1">
                    <Label className="text-xs">Número WhatsApp Business da agência</Label>
                    <Input
                      value={localSettings.whatsappPhoneNumber as string ?? ""}
                      onChange={(e) => setLocalSettings((s) => ({ ...s, whatsappPhoneNumber: e.target.value }))}
                      placeholder="5511999999999 (código do país + DDD + número)"
                    />
                    <p className="text-[11px] text-muted-foreground">Número configurado na sua instância Z-API. Apenas para referência — as mensagens são enviadas via Z-API.</p>
                  </div>
                  <div className="space-y-1 border border-dashed border-muted-foreground/30 rounded-md p-2.5 bg-muted/20">
                    <Label className="text-[11px] font-medium text-muted-foreground">Número de destino para teste</Label>
                    <Input
                      className="h-7 text-xs"
                      value={whatsappTestPhone}
                      onChange={(e) => setWhatsappTestPhone(e.target.value)}
                      placeholder="5511999999999 (DDI+DDD+número)"
                    />
                    <p className="text-[10px] text-muted-foreground">Use seu próprio WhatsApp para testar os modelos abaixo.</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mensagem — conversão confirmada</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-y"
                      value={localSettings.whatsappConvertedMessage as string ?? ""}
                      onChange={(e) => setLocalSettings((s) => ({ ...s, whatsappConvertedMessage: e.target.value }))}
                      placeholder="Boa notícia! {nome} usou seu código {codigo} e comprou com a {agencia}. Seu bônus de R$ {valor} está sendo processado."
                    />
                    {(() => {
                      const len = ((localSettings.whatsappConvertedMessage as string) ?? "").length;
                      if (len === 0) return null;
                      const isWarn = len >= 800 && len < 1000;
                      const isError = len >= 1000;
                      return (
                        <p className={`text-[10px] text-right ${isError ? "text-red-500" : isWarn ? "text-amber-500" : "text-muted-foreground"}`}>
                          {len} caracteres{isError ? " · pode ser recusada pelo WhatsApp" : isWarn ? " · mensagem longa" : ""}
                        </p>
                      );
                    })()}
                    <p className="text-[11px] text-muted-foreground">
                      Variáveis:{" "}
                      <code className="bg-muted px-1 rounded">{"{nome}"}</code> nome do indicado,{" "}
                      <code className="bg-muted px-1 rounded">{"{codigo}"}</code> código de indicação,{" "}
                      <code className="bg-muted px-1 rounded">{"{agencia}"}</code> nome da agência,{" "}
                      <code className="bg-muted px-1 rounded">{"{valor}"}</code> valor do bônus.
                    </p>
                    {(localSettings.whatsappConvertedMessage as string)?.trim() && (
                      <p className="text-[11px] text-muted-foreground bg-muted/50 border rounded px-2 py-1.5">
                        <span className="font-medium text-muted-foreground">Pré-visualização:</span>{" "}
                        {(() => {
                          const sub = (tpl: string, key: string, value: string) =>
                            tpl.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
                               .replace(new RegExp(`\\{${key}\\}`, "g"), value);
                          const valorFormatted = (settings?.bonusValue ?? 10).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          let msg = localSettings.whatsappConvertedMessage as string;
                          msg = sub(msg, "nome", "Maria");
                          msg = sub(msg, "codigo", "JOAO123");
                          msg = sub(msg, "agencia", tenantName);
                          msg = sub(msg, "valor", valorFormatted);
                          return msg;
                        })()}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {whatsappTestState.converted?.success && (
                        <p className="text-[11px] text-green-600 flex items-center gap-1 mr-auto"><Check className="w-3 h-3" /> Enviado com sucesso!</p>
                      )}
                      {whatsappTestState.converted?.error && (
                        <p className="text-[11px] text-red-500 flex items-center gap-1 mr-auto"><XCircle className="w-3 h-3" /> {whatsappTestState.converted.error}</p>
                      )}
                      <button
                        type="button"
                        disabled={!!whatsappTestState.converted?.loading}
                        onClick={() => void testWhatsappTemplate("converted")}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {whatsappTestState.converted?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        Testar envio
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mensagem — bônus pago</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-y"
                      value={localSettings.whatsappBonusPaidMessage as string ?? ""}
                      onChange={(e) => setLocalSettings((s) => ({ ...s, whatsappBonusPaidMessage: e.target.value }))}
                      placeholder="Seu bônus de R$ {{valor}} foi pago! Obrigado por indicar clientes para a {{agencia}}."
                    />
                    {(() => {
                      const len = ((localSettings.whatsappBonusPaidMessage as string) ?? "").length;
                      if (len === 0) return null;
                      const isWarn = len >= 800 && len < 1000;
                      const isError = len >= 1000;
                      return (
                        <p className={`text-[10px] text-right ${isError ? "text-red-500" : isWarn ? "text-amber-500" : "text-muted-foreground"}`}>
                          {len} caracteres{isError ? " · pode ser recusada pelo WhatsApp" : isWarn ? " · mensagem longa" : ""}
                        </p>
                      );
                    })()}
                    <p className="text-[11px] text-muted-foreground">
                      Variáveis:{" "}
                      <code className="bg-muted px-1 rounded">{"{nome}"}</code> nome do indicador,{" "}
                      <code className="bg-muted px-1 rounded">{"{codigo}"}</code> código de indicação,{" "}
                      <code className="bg-muted px-1 rounded">{"{bonus}"}</code> valor do bônus,{" "}
                      <code className="bg-muted px-1 rounded">{"{valor}"}</code> valor numérico,{" "}
                      <code className="bg-muted px-1 rounded">{"{agencia}"}</code> nome da agência.
                    </p>
                    {(localSettings.whatsappBonusPaidMessage as string)?.trim() && (
                      <p className="text-[11px] text-muted-foreground bg-muted/50 border rounded px-2 py-1.5">
                        <span className="font-medium text-muted-foreground">Pré-visualização:</span>{" "}
                        {(() => {
                          const sub = (tpl: string, key: string, value: string) =>
                            tpl.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
                               .replace(new RegExp(`\\{${key}\\}`, "g"), value);
                          const bonusFormatted = fmtCurrency(settings?.bonusValue ?? 10);
                          const valorFormatted = (settings?.bonusValue ?? 10).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          let msg = localSettings.whatsappBonusPaidMessage as string;
                          msg = sub(msg, "nome", "João");
                          msg = sub(msg, "codigo", "JOAO123");
                          msg = sub(msg, "bonus", bonusFormatted);
                          msg = sub(msg, "valor", valorFormatted);
                          msg = sub(msg, "agencia", tenantName);
                          return msg;
                        })()}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {whatsappTestState.bonusPaid?.success && (
                        <p className="text-[11px] text-green-600 flex items-center gap-1 mr-auto"><Check className="w-3 h-3" /> Enviado com sucesso!</p>
                      )}
                      {whatsappTestState.bonusPaid?.error && (
                        <p className="text-[11px] text-red-500 flex items-center gap-1 mr-auto"><XCircle className="w-3 h-3" /> {whatsappTestState.bonusPaid.error}</p>
                      )}
                      <button
                        type="button"
                        disabled={!!whatsappTestState.bonusPaid?.loading}
                        onClick={() => void testWhatsappTemplate("bonusPaid")}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {whatsappTestState.bonusPaid?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        Testar envio
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Mensagem de estorno (reversão de bônus)</Label>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-y"
                      value={localSettings.whatsappReversedMessage as string ?? ""}
                      onChange={(e) => setLocalSettings((s) => ({ ...s, whatsappReversedMessage: e.target.value }))}
                      placeholder="Olá! A reserva de {{nome}} foi cancelada e o bônus de R$ {{valor}} foi estornado do seu saldo na {{agencia}}. Seu saldo atual é R$ {{saldo}}."
                    />
                    {(() => {
                      const len = ((localSettings.whatsappReversedMessage as string) ?? "").length;
                      if (len === 0) return null;
                      const isWarn = len >= 800 && len < 1000;
                      const isError = len >= 1000;
                      return (
                        <p className={`text-[10px] text-right ${isError ? "text-red-500" : isWarn ? "text-amber-500" : "text-muted-foreground"}`}>
                          {len} caracteres{isError ? " · pode ser recusada pelo WhatsApp" : isWarn ? " · mensagem longa" : ""}
                        </p>
                      );
                    })()}
                    <p className="text-[11px] text-muted-foreground">
                      Variáveis:{" "}
                      <code className="bg-muted px-1 rounded">{"{nome}"}</code> nome do indicado,{" "}
                      <code className="bg-muted px-1 rounded">{"{valor}"}</code> valor do bônus estornado,{" "}
                      <code className="bg-muted px-1 rounded">{"{agencia}"}</code> nome da agência,{" "}
                      <code className="bg-muted px-1 rounded">{"{saldo}"}</code> saldo atual.
                    </p>
                    {(localSettings.whatsappReversedMessage as string)?.trim() && (
                      <p className="text-[11px] text-muted-foreground bg-muted/50 border rounded px-2 py-1.5">
                        <span className="font-medium text-muted-foreground">Pré-visualização:</span>{" "}
                        {(() => {
                          const sub = (tpl: string, key: string, value: string) =>
                            tpl.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value)
                               .replace(new RegExp(`\\{${key}\\}`, "g"), value);
                          const valorFormatted = (settings?.bonusValue ?? 10).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                          let msg = localSettings.whatsappReversedMessage as string;
                          msg = sub(msg, "nome", "Maria");
                          msg = sub(msg, "valor", valorFormatted);
                          msg = sub(msg, "agencia", tenantName);
                          msg = sub(msg, "saldo", "0,00");
                          return msg;
                        })()}
                      </p>
                    )}
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {whatsappTestState.reversed?.success && (
                        <p className="text-[11px] text-green-600 flex items-center gap-1 mr-auto"><Check className="w-3 h-3" /> Enviado com sucesso!</p>
                      )}
                      {whatsappTestState.reversed?.error && (
                        <p className="text-[11px] text-red-500 flex items-center gap-1 mr-auto"><XCircle className="w-3 h-3" /> {whatsappTestState.reversed.error}</p>
                      )}
                      <button
                        type="button"
                        disabled={!!whatsappTestState.reversed?.loading}
                        onClick={() => void testWhatsappTemplate("reversed")}
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {whatsappTestState.reversed?.loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        Testar envio
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Star className="w-3.5 h-3.5" />
                Níveis de Gamificação
              </Label>
              <p className="text-xs text-muted-foreground">
                Configure os limiares de indicações convertidas e o multiplicador de bônus de cada nível.
              </p>
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Nível</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Mín. convert.</th>
                      <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Multiplicador</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {(localSettings.tiersConfig ?? DEFAULT_TIERS).map((tier, idx) => {
                      const visual = TIER_VISUAL[tier.level] ?? { bg: "bg-gray-100", color: "text-gray-600" };
                      return (
                        <tr key={tier.level}>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${visual.bg} ${visual.color}`}>
                              <Star className="w-3 h-3" />
                              {tier.label}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              type="number"
                              min={0}
                              value={tier.minReferrals}
                              disabled={idx === 0}
                              className="h-7 w-20 text-xs"
                              onChange={(e) => {
                                const val = parseInt(e.target.value) || 0;
                                setLocalSettings((s) => {
                                  const tiers = [...(s.tiersConfig ?? DEFAULT_TIERS)];
                                  tiers[idx] = { ...tiers[idx], minReferrals: val };
                                  return { ...s, tiersConfig: tiers };
                                });
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1">
                              <Input
                                type="number"
                                min={0.1}
                                step={0.05}
                                value={tier.bonusMultiplier}
                                className="h-7 w-20 text-xs"
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value) || 1;
                                  setLocalSettings((s) => {
                                    const tiers = [...(s.tiersConfig ?? DEFAULT_TIERS)];
                                    tiers[idx] = { ...tiers[idx], bonusMultiplier: val };
                                    return { ...s, tiersConfig: tiers };
                                  });
                                }}
                              />
                              <span className="text-xs text-muted-foreground">×</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsModalOpen(false)}>Cancelar</Button>
            <Button onClick={saveSettings} disabled={updateSettings.isPending}>
              {updateSettings.isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>

    {/* Campaigns management dialog */}
    <Dialog open={campaignsDialogOpen} onOpenChange={setCampaignsDialogOpen}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="w-5 h-5 text-primary" />
            Campanhas de Indicação
          </DialogTitle>
          <DialogDescription>
            Crie promoções temporárias de bônus — apenas uma campanha pode estar ativa por vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Active campaign notice */}
          {activeCampaignAdmin && (
            <div className="flex items-start gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
              <Flame className="w-4 h-4 mt-0.5 shrink-0 text-green-600" />
              <span>
                <span className="font-semibold">Campanha ativa agora:</span> {activeCampaignAdmin.name} — termina em{" "}
                {new Date(activeCampaignAdmin.endsAt).toLocaleString("pt-BR")}
              </span>
            </div>
          )}

          {/* Create form toggle */}
          {!showCampaignForm ? (
            <Button variant="outline" onClick={() => setShowCampaignForm(true)}>
              <Megaphone className="w-4 h-4 mr-2" />
              Nova campanha
            </Button>
          ) : (
            <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm">Nova campanha</p>
                <Button variant="ghost" size="sm" onClick={() => { setShowCampaignForm(false); setEditingCampaignId(null); setCampaignFormData({ name: "", startsAt: "", endsAt: "", bonusType: "multiplier", bonusValue: "2", bannerText: "", eligibleStoreProductIds: "", eligibleTierLevels: [], conversionCap: "", budgetAmount: "", shareMessage: "", materialUrl: "", publicRanking: true, eligibleActivitySegments: [], eligibleChannels: "", commissionType: "none", commissionValue: "0", commissionRecipientType: "ambassador", eligiblePartnerIds: "" }); }}>
                  <XCircle className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-1">
                <Label>Nome da campanha *</Label>
                <Input
                  value={campaignFormData.name}
                  onChange={(e) => setCampaignFormData((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Bônus Duplo de Maio, Promoção Férias"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Início *</Label>
                  <Input
                    type="datetime-local"
                    value={campaignFormData.startsAt}
                    onChange={(e) => setCampaignFormData((f) => ({ ...f, startsAt: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Término *</Label>
                  <Input
                    type="datetime-local"
                    value={campaignFormData.endsAt}
                    onChange={(e) => setCampaignFormData((f) => ({ ...f, endsAt: e.target.value }))}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Tipo de bônus *</Label>
                  <Select
                    value={campaignFormData.bonusType}
                    onValueChange={(v) => setCampaignFormData((f) => ({ ...f, bonusType: v as any }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiplier">Multiplicador (×)</SelectItem>
                      <SelectItem value="fixed_extra">Bônus Fixo Extra (+R$)</SelectItem>
                      <SelectItem value="fixed_bonus">Bônus Fixo (R$)</SelectItem>
                      <SelectItem value="percentage_bonus">Bônus Percentual (%)</SelectItem>
                      <SelectItem value="reduced_bonus">Bônus Reduzido</SelectItem>
                      <SelectItem value="no_reward">Sem Bônus</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {campaignFormData.bonusType !== "no_reward" && (
                  <div className="space-y-1">
                    <Label>
                      {campaignFormData.bonusType === "multiplier" ? "Multiplicador *" : "Valor/Percentual *"}
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      value={campaignFormData.bonusValue}
                      onChange={(e) => setCampaignFormData((f) => ({ ...f, bonusValue: e.target.value }))}
                    />
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Teto de conversões</Label>
                  <Input
                    type="number"
                    min="1"
                    placeholder="Ex: 100"
                    value={campaignFormData.conversionCap}
                    onChange={(e) => setCampaignFormData((f) => ({ ...f, conversionCap: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Orçamento (R$)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Ex: 5000.00"
                    value={campaignFormData.budgetAmount}
                    onChange={(e) => setCampaignFormData((f) => ({ ...f, budgetAmount: e.target.value }))}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label>Níveis elegíveis (Tiers)</Label>
                <Select
                  value={campaignFormData.eligibleTierLevels.length === 0 ? "all" : "custom"}
                  onValueChange={(v) => setCampaignFormData((f) => ({ ...f, eligibleTierLevels: v === "all" ? [] : ["bronze"] }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os níveis</SelectItem>
                    <SelectItem value="custom">Níveis específicos</SelectItem>
                  </SelectContent>
                </Select>
                {campaignFormData.eligibleTierLevels.length > 0 && (
                  <div className="flex gap-2 flex-wrap mt-2">
                    {[
                      { id: "bronze", label: "Bronze" },
                      { id: "silver", label: "Prata" },
                      { id: "gold", label: "Ouro" },
                      { id: "diamond", label: "Diamante" }
                    ].map((t) => (
                      <div key={t.id} className="flex items-center space-x-1">
                        <Checkbox
                          id={`tier-${t.id}`}
                          checked={campaignFormData.eligibleTierLevels.includes(t.id)}
                          onCheckedChange={(checked) => {
                            setCampaignFormData((f) => {
                              const list = checked
                                ? [...f.eligibleTierLevels, t.id]
                                : f.eligibleTierLevels.filter((x) => x !== t.id);
                              return { ...f, eligibleTierLevels: list };
                            });
                          }}
                        />
                        <Label htmlFor={`tier-${t.id}`} className="text-xs">{t.label}</Label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label>ID dos produtos elegíveis da loja</Label>
                <Input
                  value={campaignFormData.eligibleStoreProductIds}
                  onChange={(e) => setCampaignFormData((f) => ({ ...f, eligibleStoreProductIds: e.target.value }))}
                  placeholder="prod_1, prod_2 (separados por vírgula)"
                />
              </div>

              <div className="space-y-2">
                <Label>Atividade dos participantes</Label>
                <p className="text-xs text-muted-foreground">Sem seleção, todos participam. Ativo: 3+ conversões; ocasional: 1–2; inativo: nenhuma.</p>
                <div className="flex flex-wrap gap-3">
                  {([
                    ["active", "Ativos"],
                    ["occasional", "Ocasionais"],
                    ["inactive", "Inativos"],
                  ] as const).map(([segment, label]) => (
                    <div key={segment} className="flex items-center space-x-1">
                      <Checkbox
                        id={`activity-${segment}`}
                        checked={campaignFormData.eligibleActivitySegments.includes(segment)}
                        onCheckedChange={(checked) => setCampaignFormData((f) => ({
                          ...f,
                          eligibleActivitySegments: checked
                            ? [...f.eligibleActivitySegments, segment]
                            : f.eligibleActivitySegments.filter((item) => item !== segment),
                        }))}
                      />
                      <Label htmlFor={`activity-${segment}`} className="text-xs">{label}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <Label>Canais elegíveis</Label>
                <Input
                  value={campaignFormData.eligibleChannels}
                  onChange={(e) => setCampaignFormData((f) => ({ ...f, eligibleChannels: e.target.value }))}
                  placeholder="instagram, whatsapp, instagram:story"
                />
                <p className="text-xs text-muted-foreground">Use origem ou origem:meio. Sem canais, links diretos e todos os UTMs são aceitos.</p>
              </div>

              <div className="space-y-1">
                <Label>Material da campanha (URL)</Label>
                <Input
                  value={campaignFormData.materialUrl}
                  onChange={(e) => setCampaignFormData((f) => ({ ...f, materialUrl: e.target.value }))}
                  placeholder="Link para banners ou imagens"
                />
              </div>

              <div className="space-y-1">
                <Label>Mensagem de compartilhamento específica</Label>
                <Input
                  value={campaignFormData.shareMessage}
                  onChange={(e) => setCampaignFormData((f) => ({ ...f, shareMessage: e.target.value }))}
                  placeholder="Texto sugerido para o cliente enviar"
                />
              </div>

              <div className="flex items-center justify-between border rounded-lg p-3 bg-white">
                <div>
                  <Label>Ranking público</Label>
                  <p className="text-xs text-muted-foreground">Exibir ranking dos melhores indicadores para os clientes</p>
                </div>
                <Switch
                  checked={campaignFormData.publicRanking}
                  onCheckedChange={(v) => setCampaignFormData((f) => ({ ...f, publicRanking: v }))}
                />
              </div>

              <div className="space-y-2 border rounded-lg p-3 bg-white">
                <p className="font-semibold text-sm">Comissionamento de Parceiros</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Tipo de comissão</Label>
                    <Select
                      value={campaignFormData.commissionType}
                      onValueChange={(v) => setCampaignFormData((f) => ({ ...f, commissionType: v as any }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sem comissão</SelectItem>
                        <SelectItem value="fixed">Valor Fixo (R$)</SelectItem>
                        <SelectItem value="bonus_percentage">Percentual do Bônus (%)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {campaignFormData.commissionType !== "none" && (
                    <div className="space-y-1">
                      <Label>Valor/Percentual</Label>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        value={campaignFormData.commissionValue}
                        onChange={(e) => setCampaignFormData((f) => ({ ...f, commissionValue: e.target.value }))}
                      />
                    </div>
                  )}
                </div>
                {campaignFormData.commissionType !== "none" && (
                  <>
                    <div className="space-y-1">
                      <Label>Beneficiário da comissão</Label>
                      <Select
                        value={campaignFormData.commissionRecipientType}
                        onValueChange={(v) => setCampaignFormData((f) => ({ ...f, commissionRecipientType: v as "ambassador" | "partner" }))}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ambassador">Divulgador elegível</SelectItem>
                          <SelectItem value="partner">Parceiro elegível do produto vendido</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Divulgadores precisam ter adesão ao programa e código ativo. Parceiros precisam estar ativos e habilitados no contrato.
                      </p>
                    </div>
                    {campaignFormData.commissionRecipientType === "partner" && (
                      <div className="space-y-1">
                        <Label>Parceiros participantes (opcional)</Label>
                        <Input
                          value={campaignFormData.eligiblePartnerIds}
                          onChange={(e) => setCampaignFormData((f) => ({ ...f, eligiblePartnerIds: e.target.value }))}
                          placeholder="IDs separados por vírgula; vazio aceita qualquer parceiro elegível do pedido"
                        />
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="space-y-1">
                <Label>
                  Texto do banner{" "}
                  <span className="text-muted-foreground font-normal text-xs">(opcional)</span>
                </Label>
                <Input
                  value={campaignFormData.bannerText}
                  onChange={(e) => setCampaignFormData((f) => ({ ...f, bannerText: e.target.value }))}
                  placeholder="Ex: Bônus dobrado esse fim de semana!"
                />
                <p className="text-xs text-muted-foreground">
                  Exibido no app do cliente durante a campanha. Deixe vazio para texto automático.
                </p>
              </div>

              <Button onClick={handleSaveCampaign} disabled={createCampaign.isPending || updateCampaign.isPending}>
                {(createCampaign.isPending || updateCampaign.isPending) && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {(createCampaign.isPending || updateCampaign.isPending)
                  ? "Salvando..."
                  : editingCampaignId ? "Salvar alterações" : "Criar campanha"}
              </Button>
            </div>
          )}

          {/* Campaigns list */}
          {campaigns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Megaphone className="w-8 h-8 mx-auto mb-2 opacity-30" />
              Nenhuma campanha criada ainda
            </div>
          ) : (
            <div className="space-y-2">
              {campaigns.map((c) => {
                const status = getCampaignStatus(c);
                return (
                  <div key={c.id} className="flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/30 transition-colors">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {status === "active" ? (
                          <Badge className="bg-green-500 text-white">Ativa</Badge>
                        ) : status === "upcoming" ? (
                          <Badge variant="outline" className="border-blue-400 text-blue-600">Agendada</Badge>
                        ) : (
                          <Badge variant="secondary">Encerrada</Badge>
                        )}
                        <span className="font-medium text-sm">{c.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(c.startsAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                        {" → "}
                        {new Date(c.endsAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                      </p>
                      <p className="text-xs mt-0.5 font-medium">
                        {c.bonusType === "multiplier" && `× ${Number(c.bonusValue).toFixed(2).replace(".00","")} no bônus`}
                        {c.bonusType === "fixed_extra" && `+ ${fmtCurrency(Number(c.bonusValue))} de bônus extra`}
                        {c.bonusType === "fixed_bonus" && `Bônus fixo de ${fmtCurrency(Number(c.bonusValue))}`}
                        {c.bonusType === "percentage_bonus" && `Bônus de ${Number(c.bonusValue).toFixed(1)}%`}
                        {c.bonusType === "reduced_bonus" && `Bônus reduzido: ${fmtCurrency(Number(c.bonusValue))}`}
                        {c.bonusType === "no_reward" && getReferralCampaignRewardLabel(c.bonusType)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {c.referralsCount ?? 0} conversão{(c.referralsCount ?? 0) !== 1 ? "ões" : ""} · {fmtCurrency(c.bonusPaidAmount ?? 0)} pagos
                      </p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.commissionType && c.commissionType !== "none" && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-blue-200 text-blue-700 bg-blue-50/50">
                            Comissão: {c.commissionType === "fixed" ? fmtCurrency(Number(c.commissionValue)) : `${Number(c.commissionValue)}% do bônus`} · {c.commissionRecipientType === "partner" ? "parceiro" : "divulgador"}
                          </Badge>
                        )}
                        {c.commissionRecipientType === "partner" && c.eligiblePartnerIds?.length > 0 && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-blue-200 text-blue-700 bg-blue-50/50">
                            {c.eligiblePartnerIds.length} parceiro{c.eligiblePartnerIds.length !== 1 ? "s" : ""} selecionado{c.eligiblePartnerIds.length !== 1 ? "s" : ""}
                          </Badge>
                        )}
                        {c.eligibleTierLevels && c.eligibleTierLevels.length > 0 && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 border-amber-200 text-amber-700 bg-amber-50/50">
                            Tiers: {c.eligibleTierLevels.map(t => ({ bronze: "Bronze", silver: "Prata", gold: "Ouro", diamond: "Diamante" }[t] || t)).join(", ")}
                          </Badge>
                        )}
                        {c.conversionCap && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                            Máx: {c.conversionCap} conv.
                          </Badge>
                        )}
                        {c.materialUrl && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-purple-700 border-purple-200 bg-purple-50/50">
                            Com material
                          </Badge>
                        )}
                        {c.shareMessage && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-indigo-700 border-indigo-200 bg-indigo-50/50">
                            Mensagem custom.
                          </Badge>
                        )}
                        {c.publicRanking && (
                          <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-emerald-700 border-emerald-200 bg-emerald-50/50">
                            Ranking público
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => handleEditCampaign(c)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => handleDeleteCampaign(c.id)}
                        disabled={deleteCampaign.isPending}
                      >
                        <Ban className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
    </>
  );
}
