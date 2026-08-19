import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Row,
  Column,
  Heading,
  Text,
  Button,
  Hr,
  Img,
  Link,
} from '@react-email/components'

export interface ReservationCredentials {
  email: string
  setupUrl: string
  loginUrl: string
  plainTextPassword?: string
}

export interface ReservationConfirmationEmailProps {
  reservationNumber: string
  voucherCode: string
  clientName: string
  clientCpf: string
  clientEmail: string
  clientPhone: string
  tripTitle: string
  destination: string
  departureDate: string
  duration: string
  seats: string[]
  totalAmount: number
  amountPaid: number
  amountPending: number
  paymentMethod: string
  paymentStatus: 'pending' | 'partial' | 'paid'
  /** Referral discount amount applied to this reservation (> 0 when present). */
  discountReferralAmount?: number
  /** Percentage value of the referral discount (e.g. 5 for 5%), only set when the discount type is "percentage". */
  discountReferralPercent?: number
  /** Coupon discount amount applied to this reservation (> 0 when present). */
  discountCouponAmount?: number
  agencyName: string
  agencyLogo: string
  agencyPhone: string
  agencyPhoneVoice?: string
  agencyEmail: string
  agencyWebsite: string
  voucherUrl: string
  consultUrl: string
  whatsappUrl: string
  /** Deep-link to the client's "Reservas" tab on their portal profile page (/perfil?tab=reservas). Optional — omit when the client has no portal account. */
  profileUrl?: string
  credentials?: ReservationCredentials
}

export function ReservationConfirmationEmail({
  reservationNumber,
  voucherCode,
  clientName,
  clientCpf,
  clientEmail,
  clientPhone,
  tripTitle,
  destination,
  departureDate,
  duration,
  seats,
  totalAmount,
  amountPaid,
  amountPending,
  paymentMethod,
  paymentStatus,
  discountReferralAmount,
  discountReferralPercent,
  discountCouponAmount,
  agencyName,
  agencyLogo,
  agencyPhone,
  agencyPhoneVoice,
  agencyEmail,
  agencyWebsite,
  voucherUrl,
  consultUrl,
  whatsappUrl,
  profileUrl,
  credentials,
}: ReservationConfirmationEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={headerSuccess}>
            <div style={successIcon}>✓</div>
            <Heading style={successTitle}>Reserva Confirmada! 🎉</Heading>
            <Text style={successSubtitle}>
              Sua reserva foi realizada com sucesso!
            </Text>
          </Section>

          {/* ORDER NUMBER */}
          <Section style={numberSection}>
            <Text style={numberLabel}>Número do Pedido</Text>
            <Text style={numberValue}>{reservationNumber}</Text>
          </Section>

          {/* TRIP DETAILS */}
          <Section style={section}>
            <Heading style={sectionTitle}>📍 Detalhes da Viagem</Heading>

            <table style={infoTable}>
              <tbody>
                <tr>
                  <td style={infoLabel}>Viagem:</td>
                  <td style={infoValue}>{tripTitle}</td>
                </tr>
                <tr>
                  <td style={infoLabel}>Destino:</td>
                  <td style={infoValue}>{destination}</td>
                </tr>
                <tr>
                  <td style={infoLabel}>Data de Saída:</td>
                  <td style={infoValue}>{departureDate}</td>
                </tr>
                <tr>
                  <td style={infoLabel}>Duração:</td>
                  <td style={infoValue}>{duration}</td>
                </tr>
                <tr>
                  <td style={infoLabel}>Passageiros:</td>
                  <td style={infoValue}>{seats.length} passageiro(s)</td>
                </tr>
              </tbody>
            </table>

            {/* Seats */}
            <div style={seatsContainer}>
              <Text style={seatsLabel}>Assentos Reservados:</Text>
              <div style={seatsGrid}>
                {seats.map((seat) => (
                  <div key={seat} style={seatBadge}>
                    Assento {seat}
                  </div>
                ))}
              </div>
            </div>
          </Section>

          <Hr style={divider} />

          {/* CLIENT INFO */}
          <Section style={section}>
            <Heading style={sectionTitle}>👤 Suas Informações</Heading>

            <table style={infoTable}>
              <tbody>
                <tr>
                  <td style={infoLabel}>Nome:</td>
                  <td style={infoValue}>{clientName}</td>
                </tr>
                <tr>
                  <td style={infoLabel}>CPF:</td>
                  <td style={infoValue}>{clientCpf}</td>
                </tr>
                <tr>
                  <td style={infoLabel}>Email:</td>
                  <td style={infoValue}>{clientEmail}</td>
                </tr>
                <tr>
                  <td style={infoLabel}>Telefone:</td>
                  <td style={infoValue}>{clientPhone}</td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Hr style={divider} />

          {/* FINANCIAL SUMMARY */}
          <Section style={section}>
            <Heading style={sectionTitle}>💰 Resumo Financeiro</Heading>

            <table style={financialTable}>
              <tbody>
                {(discountReferralAmount ?? 0) > 0 && (
                  <tr>
                    <td style={financialLabel}>
                      Desconto de Indicação{discountReferralPercent ? ` (${discountReferralPercent}%)` : ''}:
                    </td>
                    <td style={financialValueDiscount}>
                      -R$ {discountReferralAmount!.toFixed(2).replace('.', ',')}
                    </td>
                  </tr>
                )}
                {(discountCouponAmount ?? 0) > 0 && (
                  <tr>
                    <td style={financialLabel}>Desconto de Cupom:</td>
                    <td style={financialValueDiscount}>
                      -R$ {discountCouponAmount!.toFixed(2).replace('.', ',')}
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={financialLabel}>Valor Total:</td>
                  <td style={financialValue}>R$ {totalAmount.toFixed(2).replace('.', ',')}</td>
                </tr>
                <tr>
                  <td style={financialLabel}>Valor Pago:</td>
                  <td style={financialValuePaid}>R$ {amountPaid.toFixed(2).replace('.', ',')}</td>
                </tr>
                <tr style={financialTotalRow}>
                  <td style={financialTotalLabel}>Saldo Pendente:</td>
                  <td style={financialTotalValue}>R$ {amountPending.toFixed(2).replace('.', ',')}</td>
                </tr>
              </tbody>
            </table>

            <div style={paymentStatusContainer}>
              <Text style={paymentStatusLabel}>Forma de Pagamento:</Text>
              <Text style={paymentStatusValue}>
                {paymentMethod === 'pix' && 'PIX'}
                {paymentMethod === 'credit_card' && '💳 Cartão de Crédito'}
                {paymentMethod === 'debit_card' && '💳 Cartão de Débito'}
                {paymentMethod === 'bank_slip' && '📄 Boleto Bancário'}
                {!['pix','credit_card','debit_card','bank_slip'].includes(paymentMethod) && paymentMethod}
              </Text>

              {paymentStatus === 'pending' && (
                <div style={alertWarning}>
                  ⏳ Aguardando confirmação do pagamento. Você receberá um email assim que o pagamento for confirmado.
                </div>
              )}

              {paymentStatus === 'paid' && (
                <div style={alertSuccess}>
                  ✓ Pagamento confirmado!
                </div>
              )}

              {paymentStatus === 'partial' && (
                <div style={alertWarning}>
                  ⏳ Pagamento parcial registrado. Saldo pendente: R$ {amountPending.toFixed(2).replace('.', ',')}
                </div>
              )}
            </div>
          </Section>

          <Hr style={divider} />

          {/* NEXT STEPS */}
          <Section style={section}>
            <Heading style={sectionTitle}>📋 Próximos Passos</Heading>

            <div style={stepsList}>
              <div style={stepItem}>
                <div style={stepNumber}>1</div>
                <Text style={stepText}>
                  Você receberá um email de confirmação com todos os detalhes da sua reserva e o voucher em anexo.
                </Text>
              </div>
              <div style={stepItem}>
                <div style={stepNumber}>2</div>
                <Text style={stepText}>
                  Também enviaremos uma mensagem no WhatsApp com as informações de embarque.
                </Text>
              </div>
              <div style={stepItem}>
                <div style={stepNumber}>3</div>
                <Text style={stepText}>
                  Apresente o voucher e documento com foto no dia do embarque.
                </Text>
              </div>
              <div style={stepItem}>
                <div style={stepNumber}>4</div>
                <Text style={stepText}>
                  Chegue ao ponto de embarque com 30 minutos de antecedência.
                </Text>
              </div>
            </div>
          </Section>

          {/* ACTION BUTTONS */}
          <Section style={buttonsSection}>
            <Row>
              <Column style={buttonColumn}>
                <Button style={buttonPrimary} href={voucherUrl}>
                  📄 Baixar Voucher
                </Button>
              </Column>
              <Column style={buttonColumn}>
                <Button style={buttonSecondary} href={whatsappUrl}>
                  💬 Falar no WhatsApp
                </Button>
              </Column>
            </Row>
            <Row>
              <Column style={buttonColumn}>
                <Button style={buttonOutline} href={consultUrl}>
                  🔍 Consultar Pedido
                </Button>
              </Column>
              {profileUrl && (
                <Column style={buttonColumn}>
                  <Button style={buttonOutline} href={profileUrl}>
                    🎒 Minhas Reservas
                  </Button>
                </Column>
              )}
            </Row>
          </Section>

          {/* IMPORTANT INFO */}
          <Section style={alertInfo}>
            <Text style={alertTitle}>⚠️ Informações Importantes</Text>
            <ul style={alertList}>
              <li>Apresente este voucher e documento com foto no embarque</li>
              <li>Sente-se apenas no assento indicado no voucher</li>
              <li>Chegue com 30 minutos de antecedência</li>
              <li>Em caso de dúvidas, entre em contato conosco</li>
            </ul>
          </Section>

          {/* CREDENTIALS — only shown when a new account was created */}
          {credentials && (
            <>
              <Hr style={divider} />
              <Section style={credentialsSection}>
                <Heading style={credentialsSectionTitle}>🔑 Acesse sua Área do Cliente</Heading>
                <Text style={credentialsIntro}>
                  Criamos uma conta gratuita para você acompanhar sua reserva a qualquer momento.
                </Text>
                <div style={credentialsBox}>
                  <table style={infoTable}>
                    <tbody>
                      <tr>
                        <td style={infoLabel}>Login (e-mail):</td>
                        <td style={infoValue}>{credentials.email}</td>
                      </tr>
                      {credentials.plainTextPassword && (
                        <tr>
                          <td style={infoLabel}>Senha:</td>
                          <td style={infoValue}>{credentials.plainTextPassword}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {credentials.plainTextPassword ? (
                  <>
                    <Text style={credentialsNote}>
                      Use o e-mail e a senha acima para entrar na sua Área do Cliente. Você pode trocar a senha a qualquer momento pelo portal.
                    </Text>
                    <Button style={credentialsButton} href={credentials.loginUrl}>
                      Acessar Minha Área do Cliente
                    </Button>
                  </>
                ) : (
                  <>
                    <Button style={credentialsButton} href={credentials.setupUrl}>
                      Configurar Minha Senha e Acessar
                    </Button>
                    <Text style={credentialsNote}>
                      Este link é válido por 7 dias e pode ser usado apenas uma vez. Após acessar, você poderá definir sua própria senha.
                    </Text>
                  </>
                )}
              </Section>
            </>
          )}

          {/* HELP */}
          <Section style={helpSection}>
            <Heading style={helpTitle}>🆘 Precisa de Ajuda?</Heading>
            <Text style={helpText}>Nossa equipe está pronta para atendê-lo!</Text>

            <table style={contactTable}>
              <tbody>
                {agencyPhone && (
                  <tr>
                    <td style={contactIcon}>📱</td>
                    <td>
                      <Text style={contactLabel}>WhatsApp</Text>
                      <Link href={whatsappUrl} style={contactValue}>{agencyPhone}</Link>
                    </td>
                  </tr>
                )}
                {agencyPhoneVoice && agencyPhoneVoice !== agencyPhone && (
                  <tr>
                    <td style={contactIcon}>📞</td>
                    <td>
                      <Text style={contactLabel}>Telefone</Text>
                      <Link href={`tel:${agencyPhoneVoice.replace(/\D/g, '')}`} style={contactValue}>{agencyPhoneVoice}</Link>
                    </td>
                  </tr>
                )}
                <tr>
                  <td style={contactIcon}>📧</td>
                  <td>
                    <Text style={contactLabel}>Email</Text>
                    <Link href={`mailto:${agencyEmail}`} style={contactValue}>{agencyEmail}</Link>
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          {/* FOOTER */}
          <Section style={footer}>
            {agencyLogo && (
              <Img src={agencyLogo} alt={agencyName} style={footerLogo} />
            )}
            <Text style={footerText}>{agencyName}</Text>
            <Text style={footerSubtext}>Sua viagem dos sonhos começa aqui!</Text>
            {agencyWebsite && (
              <Link href={agencyWebsite} style={footerLink}>{agencyWebsite}</Link>
            )}

            <Hr style={footerDivider} />

            <Text style={footerCopyright}>
              © {new Date().getFullYear()} {agencyName}. Todos os direitos reservados.
            </Text>
            <Text style={footerDisclaimer}>
              Você está recebendo este email porque realizou uma reserva em nosso sistema.
            </Text>
          </Section>

        </Container>
      </Body>
    </Html>
  )
}

const main: React.CSSProperties = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
}

const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0',
  marginBottom: '64px',
  maxWidth: '600px',
}

const headerSuccess: React.CSSProperties = {
  backgroundColor: '#10b981',
  padding: '40px 20px',
  textAlign: 'center',
  borderRadius: '8px 8px 0 0',
}

const successIcon: React.CSSProperties = {
  width: '64px',
  height: '64px',
  backgroundColor: '#ffffff',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '32px',
  fontWeight: 'bold',
  color: '#10b981',
  margin: '0 auto 16px',
}

const successTitle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '28px',
  fontWeight: 'bold',
  margin: '0 0 8px',
}

const successSubtitle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '16px',
  margin: '0',
}

const numberSection: React.CSSProperties = {
  backgroundColor: '#f3f4f6',
  padding: '24px',
  textAlign: 'center',
  borderBottom: '1px solid #e5e7eb',
}

const numberLabel: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0 0 8px',
}

const numberValue: React.CSSProperties = {
  fontSize: '24px',
  fontWeight: 'bold',
  color: '#1f2937',
  fontFamily: 'monospace',
  letterSpacing: '2px',
  margin: '0',
}

const section: React.CSSProperties = {
  padding: '32px 24px',
}

const sectionTitle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 'bold',
  color: '#1f2937',
  margin: '0 0 20px',
}

const infoTable: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const infoLabel: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  padding: '8px 0',
  width: '40%',
}

const infoValue: React.CSSProperties = {
  fontSize: '14px',
  color: '#1f2937',
  fontWeight: '600',
  padding: '8px 0',
}

const seatsContainer: React.CSSProperties = {
  marginTop: '20px',
  padding: '16px',
  backgroundColor: '#fef3c7',
  borderRadius: '8px',
  border: '2px solid #fbbf24',
}

const seatsLabel: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 'bold',
  color: '#92400e',
  margin: '0 0 12px',
}

const seatsGrid: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '8px',
}

const seatBadge: React.CSSProperties = {
  backgroundColor: '#f59e0b',
  color: '#ffffff',
  padding: '8px 16px',
  borderRadius: '20px',
  fontSize: '14px',
  fontWeight: 'bold',
  display: 'inline-block',
}

const divider: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '0',
}

const financialTable: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const financialLabel: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  padding: '12px 0',
}

const financialValue: React.CSSProperties = {
  fontSize: '16px',
  color: '#1f2937',
  fontWeight: '600',
  textAlign: 'right',
  padding: '12px 0',
}

const financialValuePaid: React.CSSProperties = {
  fontSize: '16px',
  color: '#10b981',
  fontWeight: '600',
  textAlign: 'right',
  padding: '12px 0',
}

const financialValueDiscount: React.CSSProperties = {
  fontSize: '16px',
  color: '#10b981',
  fontWeight: '600',
  textAlign: 'right',
  padding: '12px 0',
}

const financialTotalRow: React.CSSProperties = {
  borderTop: '2px solid #e5e7eb',
}

const financialTotalLabel: React.CSSProperties = {
  fontSize: '16px',
  color: '#1f2937',
  fontWeight: 'bold',
  padding: '16px 0 12px',
}

const financialTotalValue: React.CSSProperties = {
  fontSize: '20px',
  color: '#f59e0b',
  fontWeight: 'bold',
  textAlign: 'right',
  padding: '16px 0 12px',
}

const paymentStatusContainer: React.CSSProperties = {
  marginTop: '20px',
}

const paymentStatusLabel: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0 0 4px',
}

const paymentStatusValue: React.CSSProperties = {
  fontSize: '16px',
  color: '#1f2937',
  fontWeight: '600',
  margin: '0 0 12px',
}

const alertWarning: React.CSSProperties = {
  backgroundColor: '#fef3c7',
  border: '1px solid #fbbf24',
  borderRadius: '8px',
  padding: '12px 16px',
  fontSize: '14px',
  color: '#92400e',
  marginTop: '12px',
}

const alertSuccess: React.CSSProperties = {
  backgroundColor: '#d1fae5',
  border: '1px solid #10b981',
  borderRadius: '8px',
  padding: '12px 16px',
  fontSize: '14px',
  color: '#065f46',
  marginTop: '12px',
}

const stepsList: React.CSSProperties = {
  marginTop: '16px',
}

const stepItem: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  marginBottom: '20px',
  alignItems: 'flex-start',
}

const stepNumber: React.CSSProperties = {
  minWidth: '32px',
  height: '32px',
  backgroundColor: '#3b82f6',
  color: '#ffffff',
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '16px',
  fontWeight: 'bold',
}

const stepText: React.CSSProperties = {
  fontSize: '14px',
  color: '#4b5563',
  margin: '0',
  lineHeight: '1.6',
}

const buttonsSection: React.CSSProperties = {
  padding: '24px',
  textAlign: 'center',
}

const buttonColumn: React.CSSProperties = {
  padding: '0 6px',
}

const buttonPrimary: React.CSSProperties = {
  backgroundColor: '#3b82f6',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontWeight: '600',
  fontSize: '14px',
  display: 'inline-block',
  width: '100%',
  textAlign: 'center',
}

const buttonSecondary: React.CSSProperties = {
  backgroundColor: '#10b981',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontWeight: '600',
  fontSize: '14px',
  display: 'inline-block',
  width: '100%',
  textAlign: 'center',
}

const buttonOutline: React.CSSProperties = {
  backgroundColor: 'transparent',
  color: '#3b82f6',
  padding: '12px 24px',
  borderRadius: '8px',
  border: '2px solid #3b82f6',
  textDecoration: 'none',
  fontWeight: '600',
  fontSize: '14px',
  display: 'inline-block',
  width: '100%',
  textAlign: 'center',
}

const alertInfo: React.CSSProperties = {
  backgroundColor: '#dbeafe',
  border: '1px solid #3b82f6',
  borderRadius: '8px',
  padding: '20px 24px',
  margin: '0 24px',
}

const alertTitle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#1e40af',
  margin: '0 0 12px',
}

const alertList: React.CSSProperties = {
  margin: '0',
  paddingLeft: '20px',
  fontSize: '14px',
  color: '#1e3a8a',
  lineHeight: '1.8',
}

const helpSection: React.CSSProperties = {
  padding: '32px 24px',
  backgroundColor: '#f9fafb',
}

const helpTitle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 'bold',
  color: '#1f2937',
  margin: '0 0 8px',
}

const helpText: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0 0 20px',
}

const contactTable: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const contactIcon: React.CSSProperties = {
  fontSize: '24px',
  padding: '8px 16px 8px 0',
  verticalAlign: 'top',
  width: '40px',
}

const contactLabel: React.CSSProperties = {
  fontSize: '12px',
  color: '#9ca3af',
  margin: '0',
  textTransform: 'uppercase',
  letterSpacing: '1px',
}

const contactValue: React.CSSProperties = {
  fontSize: '14px',
  color: '#3b82f6',
  fontWeight: '600',
  textDecoration: 'none',
}

const footer: React.CSSProperties = {
  backgroundColor: '#1f2937',
  padding: '32px 24px',
  textAlign: 'center',
  borderRadius: '0 0 8px 8px',
}

const footerLogo: React.CSSProperties = {
  height: '48px',
  margin: '0 auto 16px',
}

const footerText: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '18px',
  fontWeight: 'bold',
  margin: '0 0 4px',
}

const footerSubtext: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: '14px',
  margin: '0 0 12px',
}

const footerLink: React.CSSProperties = {
  color: '#60a5fa',
  fontSize: '14px',
  textDecoration: 'none',
}

const footerDivider: React.CSSProperties = {
  borderColor: '#374151',
  margin: '24px 0 16px',
}

const footerCopyright: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '12px',
  margin: '0 0 4px',
}

const footerDisclaimer: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '11px',
  margin: '0',
}

const credentialsSection: React.CSSProperties = {
  padding: '32px 24px',
  backgroundColor: '#f0f9ff',
}

const credentialsSectionTitle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 'bold',
  color: '#0369a1',
  margin: '0 0 12px',
}

const credentialsIntro: React.CSSProperties = {
  fontSize: '14px',
  color: '#475569',
  margin: '0 0 20px',
  lineHeight: '1.6',
}

const credentialsBox: React.CSSProperties = {
  backgroundColor: '#ffffff',
  border: '2px solid #0ea5e9',
  borderRadius: '8px',
  padding: '16px',
  marginBottom: '20px',
}

const credentialsButton: React.CSSProperties = {
  backgroundColor: '#0ea5e9',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontWeight: '600',
  fontSize: '14px',
  display: 'inline-block',
  textAlign: 'center',
}

const credentialsNote: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
  margin: '16px 0 0',
  textAlign: 'center',
}
