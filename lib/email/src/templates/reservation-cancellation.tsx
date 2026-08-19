import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Button,
  Hr,
  Img,
  Link,
} from '@react-email/components'

export interface ReservationCancellationEmailProps {
  reservationNumber: string
  voucherCode: string
  clientName: string
  clientEmail: string
  tripTitle: string
  destination: string
  departureDate: string
  totalAmount: number
  agencyName: string
  agencyLogo: string
  agencyPhone: string
  agencyEmail: string
  agencyWebsite: string
  whatsappUrl: string
}

export function ReservationCancellationEmail({
  reservationNumber,
  clientName,
  clientEmail,
  tripTitle,
  destination,
  departureDate,
  totalAmount,
  agencyName,
  agencyLogo,
  agencyPhone,
  agencyEmail,
  agencyWebsite,
  whatsappUrl,
}: ReservationCancellationEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={headerCancel}>
            <div style={cancelIcon}>✕</div>
            <Heading style={cancelTitle}>Reserva Cancelada</Heading>
            <Text style={cancelSubtitle}>
              Sua reserva foi cancelada conforme solicitado.
            </Text>
          </Section>

          {/* ORDER NUMBER */}
          <Section style={numberSection}>
            <Text style={numberLabel}>Número da Reserva</Text>
            <Text style={numberValue}>{reservationNumber}</Text>
          </Section>

          {/* TRIP DETAILS */}
          <Section style={section}>
            <Heading style={sectionTitle}>📍 Detalhes da Reserva Cancelada</Heading>

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
                  <td style={infoLabel}>Passageiro:</td>
                  <td style={infoValue}>{clientName}</td>
                </tr>
                <tr>
                  <td style={infoLabel}>E-mail:</td>
                  <td style={infoValue}>{clientEmail}</td>
                </tr>
                <tr>
                  <td style={infoLabel}>Valor Total:</td>
                  <td style={infoValue}>
                    R$ {totalAmount.toFixed(2).replace('.', ',')}
                  </td>
                </tr>
              </tbody>
            </table>
          </Section>

          <Hr style={divider} />

          {/* NOTICE */}
          <Section style={alertInfo}>
            <Text style={alertTitle}>ℹ️ O que acontece agora?</Text>
            <ul style={alertList}>
              <li>Sua reserva foi cancelada em nosso sistema.</li>
              <li>Caso tenha realizado algum pagamento, entre em contato conosco para tratar do reembolso.</li>
              <li>Ficamos à disposição para ajudá-lo a realizar uma nova reserva quando desejar.</li>
            </ul>
          </Section>

          {/* ACTION BUTTON */}
          <Section style={buttonsSection}>
            <Button style={buttonSecondary} href={whatsappUrl}>
              💬 Falar com a Agência no WhatsApp
            </Button>
          </Section>

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

const headerCancel: React.CSSProperties = {
  backgroundColor: '#ef4444',
  padding: '40px 20px',
  textAlign: 'center',
  borderRadius: '8px 8px 0 0',
}

const cancelIcon: React.CSSProperties = {
  width: '64px',
  height: '64px',
  backgroundColor: '#ffffff',
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '32px',
  fontWeight: 'bold',
  color: '#ef4444',
  margin: '0 auto 16px',
}

const cancelTitle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '28px',
  fontWeight: 'bold',
  margin: '0 0 8px',
}

const cancelSubtitle: React.CSSProperties = {
  color: '#fecaca',
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

const divider: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '0',
}

const alertInfo: React.CSSProperties = {
  backgroundColor: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: '8px',
  padding: '20px 24px',
  margin: '0 24px',
}

const alertTitle: React.CSSProperties = {
  fontSize: '16px',
  fontWeight: 'bold',
  color: '#991b1b',
  margin: '0 0 12px',
}

const alertList: React.CSSProperties = {
  margin: '0',
  paddingLeft: '20px',
  fontSize: '14px',
  color: '#7f1d1d',
  lineHeight: '1.8',
}

const buttonsSection: React.CSSProperties = {
  padding: '24px',
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
  margin: '0 0 8px',
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
  color: '#9ca3af',
  fontSize: '12px',
  margin: '0 0 4px',
}

const footerDisclaimer: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '11px',
  margin: '0',
}
