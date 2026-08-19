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
} from '@react-email/components'

export interface AgencyReactivatedEmailProps {
  agencyName: string
  loginUrl?: string
  platformName?: string
}

export function AgencyReactivatedEmail({
  agencyName,
  loginUrl = 'https://app.visitecrm.com.br',
  platformName = 'VisiteCRM',
}: AgencyReactivatedEmailProps) {
  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={header}>
            <div style={iconWrap}>✅</div>
            <Heading style={headerTitle}>Conta Reativada</Heading>
            <Text style={headerSubtitle}>
              O acesso da sua agência ao {platformName} foi restaurado.
            </Text>
          </Section>

          {/* BODY */}
          <Section style={section}>
            <Text style={bodyText}>
              Olá, <strong>{agencyName}</strong>,
            </Text>
            <Text style={bodyText}>
              Boas notícias! A suspensão da sua conta na plataforma <strong>{platformName}</strong>{' '}
              foi encerrada e o acesso ao sistema foi totalmente restaurado.
            </Text>
            <Text style={bodyText}>
              Todos os usuários da agência já podem voltar a acessar o sistema normalmente.
            </Text>
          </Section>

          {/* CTA */}
          <Section style={buttonSection}>
            <Button style={buttonPrimary} href={loginUrl}>
              🚀 Acessar o Sistema
            </Button>
          </Section>

          <Hr style={divider} />

          {/* SUPPORT NOTE */}
          <Section style={section}>
            <div style={supportNote}>
              <Text style={supportText}>
                Caso tenha alguma dúvida ou precise de ajuda para retomar as operações,
                nossa equipe de suporte está à disposição.
              </Text>
            </div>
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
              Esta é uma notificação automática do sistema.
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
  backgroundColor: '#16a34a',
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
  color: '#bbf7d0',
  fontSize: '16px',
  margin: '0',
}

const section: React.CSSProperties = {
  padding: '32px 24px',
}

const bodyText: React.CSSProperties = {
  fontSize: '15px',
  color: '#4b5563',
  lineHeight: '1.7',
  margin: '0 0 12px',
}

const buttonSection: React.CSSProperties = {
  padding: '16px 24px 32px',
  textAlign: 'center',
}

const buttonPrimary: React.CSSProperties = {
  backgroundColor: '#16a34a',
  color: '#ffffff',
  padding: '16px 32px',
  borderRadius: '10px',
  textDecoration: 'none',
  fontWeight: '700',
  fontSize: '16px',
  display: 'inline-block',
  textAlign: 'center',
  letterSpacing: '0.3px',
}

const supportNote: React.CSSProperties = {
  backgroundColor: '#f0fdf4',
  border: '1px solid #86efac',
  borderRadius: '8px',
  padding: '16px 20px',
}

const supportText: React.CSSProperties = {
  fontSize: '14px',
  color: '#166534',
  margin: '0',
  lineHeight: '1.6',
  textAlign: 'center',
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
