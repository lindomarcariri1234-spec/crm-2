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
} from '@react-email/components'

export interface NewBookingNotificationEmailProps {
  agencyName: string
  agencyLogo?: string | null
  clientName: string
  clientEmail?: string
  clientPhone?: string
  destination: string
  departureDate: string
  reservationNumber: string
  totalValue: number
  crmReservationUrl: string
}

export function NewBookingNotificationEmail({
  agencyName,
  agencyLogo,
  clientName,
  clientEmail,
  clientPhone,
  destination,
  departureDate,
  reservationNumber,
  totalValue,
  crmReservationUrl,
}: NewBookingNotificationEmailProps) {
  const totalFormatted = totalValue.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={header}>
            <div style={iconWrap}>🛎️</div>
            <Heading style={headerTitle}>Nova reserva recebida</Heading>
            <Text style={headerSubtitle}>
              Um cliente acabou de reservar pela vitrine da {agencyName}.
            </Text>
          </Section>

          <Section style={section}>
            <Text style={bodyText}>
              Olá, equipe! Uma nova reserva foi criada pela vitrine pública e
              precisa ser atendida.
            </Text>
          </Section>

          <Section style={section}>
            <Heading style={sectionTitle}>📋 Detalhes da reserva</Heading>
            <div style={detailsBox}>
              <table style={detailsTable}>
                <tbody>
                  <tr>
                    <td style={detailLabel}>Reserva:</td>
                    <td style={detailValue}>{reservationNumber}</td>
                  </tr>
                  <tr>
                    <td style={detailLabel}>Cliente:</td>
                    <td style={detailValue}>{clientName}</td>
                  </tr>
                  {clientEmail ? (
                    <tr>
                      <td style={detailLabel}>E-mail:</td>
                      <td style={detailValue}>{clientEmail}</td>
                    </tr>
                  ) : null}
                  {clientPhone ? (
                    <tr>
                      <td style={detailLabel}>Telefone:</td>
                      <td style={detailValue}>{clientPhone}</td>
                    </tr>
                  ) : null}
                  <tr>
                    <td style={detailLabel}>Destino:</td>
                    <td style={detailValue}>{destination}</td>
                  </tr>
                  <tr>
                    <td style={detailLabel}>Embarque:</td>
                    <td style={detailValue}>{departureDate}</td>
                  </tr>
                  <tr>
                    <td style={detailLabel}>Valor total:</td>
                    <td style={detailValueStrong}>{totalFormatted}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section style={buttonSection}>
            <Button style={buttonPrimary} href={crmReservationUrl}>
              Abrir reserva no CRM
            </Button>
          </Section>

          <Hr style={divider} />

          <Section style={footer}>
            {agencyLogo ? (
              <Img src={agencyLogo} alt={agencyName} style={footerLogo} />
            ) : null}
            <Text style={footerText}>{agencyName}</Text>
            <Text style={footerSubtext}>
              Notificação automática do VisiteCRM.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const main: React.CSSProperties = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
}

const container: React.CSSProperties = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0',
  marginBottom: '64px',
  maxWidth: '600px',
}

const header: React.CSSProperties = {
  backgroundColor: '#0f766e',
  padding: '40px 20px',
  textAlign: 'center',
  borderRadius: '8px 8px 0 0',
}

const iconWrap: React.CSSProperties = {
  fontSize: '44px',
  marginBottom: '12px',
}

const headerTitle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '26px',
  fontWeight: 'bold',
  margin: '0 0 8px',
}

const headerSubtitle: React.CSSProperties = {
  color: '#a7f3d0',
  fontSize: '15px',
  margin: '0',
}

const section: React.CSSProperties = {
  padding: '24px',
}

const sectionTitle: React.CSSProperties = {
  fontSize: '17px',
  fontWeight: 'bold',
  color: '#1f2937',
  margin: '0 0 12px',
}

const bodyText: React.CSSProperties = {
  fontSize: '15px',
  color: '#4b5563',
  lineHeight: '1.7',
  margin: '0 0 8px',
}

const detailsBox: React.CSSProperties = {
  backgroundColor: '#f0fdfa',
  border: '1px solid #99f6e4',
  borderRadius: '10px',
  padding: '20px',
}

const detailsTable: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const detailLabel: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  padding: '6px 0',
  width: '140px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.4px',
  fontWeight: 600,
  verticalAlign: 'top',
}

const detailValue: React.CSSProperties = {
  fontSize: '15px',
  color: '#0f172a',
  padding: '6px 0',
  fontWeight: 500,
}

const detailValueStrong: React.CSSProperties = {
  ...detailValue,
  color: '#047857',
  fontWeight: 700,
}

const buttonSection: React.CSSProperties = {
  padding: '8px 24px 32px',
  textAlign: 'center',
}

const buttonPrimary: React.CSSProperties = {
  backgroundColor: '#0f766e',
  color: '#ffffff',
  padding: '14px 28px',
  borderRadius: '10px',
  textDecoration: 'none',
  fontWeight: 700,
  fontSize: '15px',
  display: 'inline-block',
  letterSpacing: '0.3px',
}

const divider: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '0',
}

const footer: React.CSSProperties = {
  backgroundColor: '#1f2937',
  padding: '28px 24px',
  textAlign: 'center',
  borderRadius: '0 0 8px 8px',
}

const footerLogo: React.CSSProperties = {
  height: '40px',
  margin: '0 auto 12px',
}

const footerText: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 'bold',
  margin: '0 0 4px',
}

const footerSubtext: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: '12px',
  margin: '0',
}
