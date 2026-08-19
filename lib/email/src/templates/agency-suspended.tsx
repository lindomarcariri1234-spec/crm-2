import * as React from 'react'
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Heading,
  Text,
  Hr,
  Img,
} from '@react-email/components'

export interface AgencySuspendedEmailProps {
  agencyName: string
  agencyEmail: string
  reason?: string | null
  supportEmail?: string
  platformName?: string
}

export function AgencySuspendedEmail({
  agencyName,
  agencyEmail,
  reason,
  supportEmail = 'suporte@visitecrm.com',
  platformName = 'VisiteCRM',
}: AgencySuspendedEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={header}>
            <div style={iconWrap}>⚠️</div>
            <Heading style={headerTitle}>Conta Suspensa</Heading>
            <Text style={headerSubtitle}>
              O acesso da sua agência ao {platformName} foi temporariamente suspenso.
            </Text>
          </Section>

          {/* BODY */}
          <Section style={section}>
            <Text style={bodyText}>
              Olá, <strong>{agencyName}</strong>,
            </Text>
            <Text style={bodyText}>
              Informamos que o acesso da sua conta na plataforma <strong>{platformName}</strong> foi
              suspenso. Enquanto a conta estiver suspensa, os usuários da agência não conseguirão
              acessar o sistema.
            </Text>

            {reason ? (
              <div style={reasonBox}>
                <Text style={reasonLabel}>Motivo informado:</Text>
                <Text style={reasonText}>{reason}</Text>
              </div>
            ) : null}

            <Text style={bodyText}>
              Para regularizar sua conta e reativar o acesso, entre em contato com nossa equipe
              de suporte o mais rápido possível.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* CONTACT */}
          <Section style={section}>
            <Heading style={sectionTitle}>📩 Entre em contato</Heading>
            <div style={contactBox}>
              <Text style={contactText}>
                Responda este e-mail ou envie uma mensagem para:
              </Text>
              <Text style={contactEmail}>{supportEmail}</Text>
            </div>
            <Text style={bodyText}>
              Informe o nome da sua agência (<strong>{agencyName}</strong>) e o e-mail cadastrado
              (<strong>{agencyEmail}</strong>) para agilizar o atendimento.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* FOOTER */}
          <Section style={footer}>
            <Text style={footerText}>{platformName}</Text>
            <Text style={footerSubtext}>Plataforma de gestão para agências de turismo</Text>

            <Hr style={footerDivider} />

            <Text style={footerCopyright}>
              © {new Date().getFullYear()} {platformName}. Todos os direitos reservados.
            </Text>
            <Text style={footerDisclaimer}>
              Esta é uma notificação automática do sistema. Caso acredite que houve um engano,
              entre em contato com o suporte.
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

const header: React.CSSProperties = {
  backgroundColor: '#dc2626',
  padding: '40px 20px',
  textAlign: 'center',
  borderRadius: '8px 8px 0 0',
}

const iconWrap: React.CSSProperties = {
  fontSize: '48px',
  display: 'block',
  marginBottom: '12px',
}

const headerTitle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '28px',
  fontWeight: 'bold',
  margin: '0 0 8px',
}

const headerSubtitle: React.CSSProperties = {
  color: '#fecaca',
  fontSize: '16px',
  margin: '0',
}

const section: React.CSSProperties = {
  padding: '32px 24px',
}

const sectionTitle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 'bold',
  color: '#1f2937',
  margin: '0 0 16px',
}

const bodyText: React.CSSProperties = {
  fontSize: '15px',
  color: '#4b5563',
  lineHeight: '1.7',
  margin: '0 0 12px',
}

const reasonBox: React.CSSProperties = {
  backgroundColor: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: '8px',
  padding: '16px 20px',
  marginBottom: '16px',
}

const reasonLabel: React.CSSProperties = {
  fontSize: '12px',
  color: '#991b1b',
  fontWeight: '600',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  margin: '0 0 6px',
}

const reasonText: React.CSSProperties = {
  fontSize: '14px',
  color: '#7f1d1d',
  margin: '0',
  lineHeight: '1.6',
}

const contactBox: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  padding: '16px 20px',
  marginBottom: '16px',
  textAlign: 'center',
}

const contactText: React.CSSProperties = {
  fontSize: '14px',
  color: '#6b7280',
  margin: '0 0 8px',
}

const contactEmail: React.CSSProperties = {
  fontSize: '16px',
  color: '#1d4ed8',
  fontWeight: '600',
  margin: '0',
}

const divider: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '0',
}

const footer: React.CSSProperties = {
  backgroundColor: '#1f2937',
  padding: '32px 24px',
  textAlign: 'center',
  borderRadius: '0 0 8px 8px',
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
