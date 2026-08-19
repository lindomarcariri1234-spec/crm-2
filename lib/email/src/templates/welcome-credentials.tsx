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

export interface WelcomeCredentialsEmailProps {
  clientName: string
  clientEmail: string
  setupUrl: string
  loginUrl: string
  agencyName: string
  agencyLogo?: string | null
  isMagicLink?: boolean
  plainTextPassword?: string
}

export function WelcomeCredentialsEmail({
  clientName,
  clientEmail,
  setupUrl,
  loginUrl,
  agencyName,
  agencyLogo,
  isMagicLink = false,
  plainTextPassword,
}: WelcomeCredentialsEmailProps) {
  const firstName = clientName.split(' ')[0]

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={header}>
            <div style={iconWrap}>🎉</div>
            <Heading style={headerTitle}>Bem-vindo(a), {firstName}!</Heading>
            <Text style={headerSubtitle}>
              Sua conta foi criada. Acesse sua Área do Cliente.
            </Text>
          </Section>

          {/* INTRO */}
          <Section style={section}>
            <Text style={bodyText}>
              Olá, <strong>{clientName}</strong>!
            </Text>
            <Text style={bodyText}>
              Criamos uma conta gratuita para você acompanhar suas viagens, baixar
              vouchers e verificar pagamentos diretamente na sua Área do Cliente.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* ACCESS INFO */}
          <Section style={section}>
            <Heading style={sectionTitle}>🔐 Seu acesso</Heading>
            <div style={credentialsBox}>
              <table style={credTable}>
                <tbody>
                  <tr>
                    <td style={credLabel}>E-mail:</td>
                    <td style={credValue}>{clientEmail}</td>
                  </tr>
                  {plainTextPassword && (
                    <tr>
                      <td style={credLabel}>Senha:</td>
                      <td style={credValue}>{plainTextPassword}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {plainTextPassword ? (
              <div style={alertInfo}>
                🔒 Use o e-mail e a senha acima para entrar na sua Área do Cliente.
                Você pode trocar a senha a qualquer momento pelo portal.
              </div>
            ) : isMagicLink ? (
              <div style={alertInfo}>
                🔗 Use o botão abaixo para entrar automaticamente — sem precisar de
                senha. O link é válido por 7 dias.
              </div>
            ) : (
              <div style={alertInfo}>
                🔗 Use o botão abaixo para acessar sua Área do Cliente. Entre com
                seu e-mail e defina uma senha no primeiro acesso.
              </div>
            )}
          </Section>

          {/* CTA BUTTON */}
          <Section style={buttonSection}>
            <Button style={buttonPrimary} href={plainTextPassword ? loginUrl : setupUrl}>
              🚀 Acessar Minha Área
            </Button>
          </Section>

          <Hr style={divider} />

          {/* WHAT CAN I DO */}
          <Section style={section}>
            <Heading style={sectionTitle}>📋 Na sua Área do Cliente você pode:</Heading>
            <div style={featuresList}>
              <div style={featureItem}>🗓️ <span style={featureText}>Ver suas viagens agendadas</span></div>
              <div style={featureItem}>📄 <span style={featureText}>Baixar vouchers de reserva</span></div>
              <div style={featureItem}>💰 <span style={featureText}>Acompanhar pagamentos pendentes</span></div>
              <div style={featureItem}>🌟 <span style={featureText}>Consultar seus pontos de fidelidade</span></div>
              <div style={featureItem}>👥 <span style={featureText}>Indicar amigos e ganhar descontos</span></div>
            </div>
          </Section>

          <Hr style={divider} />

          {/* FALLBACK LOGIN */}
          <Section style={section}>
            <Text style={fallbackText}>
              Prefere entrar com e-mail e senha?{' '}
              <Link href={loginUrl} style={fallbackLink}>
                Clique aqui para ir à página de login
              </Link>
            </Text>
          </Section>

          <Hr style={divider} />

          {/* FOOTER */}
          <Section style={footer}>
            {agencyLogo && (
              <Img src={agencyLogo} alt={agencyName} style={footerLogo} />
            )}
            <Text style={footerText}>{agencyName}</Text>
            <Text style={footerSubtext}>Sua viagem dos sonhos começa aqui!</Text>

            <Hr style={footerDivider} />

            <Text style={footerCopyright}>
              © {new Date().getFullYear()} {agencyName}. Todos os direitos reservados.
            </Text>
            <Text style={footerDisclaimer}>
              Você está recebendo este email porque realizou uma reserva em nosso sistema.
              Caso não reconheça esta reserva, ignore este email.
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
  backgroundColor: '#3b82f6',
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
  color: '#bfdbfe',
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

const credentialsBox: React.CSSProperties = {
  backgroundColor: '#f0f9ff',
  border: '2px solid #3b82f6',
  borderRadius: '12px',
  padding: '24px',
  marginBottom: '16px',
}

const credTable: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
}

const credLabel: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  padding: '6px 0',
  width: '160px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  fontWeight: '600',
}

const credValue: React.CSSProperties = {
  fontSize: '15px',
  color: '#1e40af',
  fontWeight: '600',
  padding: '6px 0',
}

const alertInfo: React.CSSProperties = {
  backgroundColor: '#eff6ff',
  border: '1px solid #93c5fd',
  borderRadius: '8px',
  padding: '12px 16px',
  fontSize: '13px',
  color: '#1e40af',
}

const featuresList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '10px',
}

const featureItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  fontSize: '14px',
  color: '#374151',
  padding: '8px 12px',
  backgroundColor: '#f9fafb',
  borderRadius: '8px',
}

const featureText: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
}

const buttonSection: React.CSSProperties = {
  padding: '16px 24px 32px',
  textAlign: 'center',
}

const buttonPrimary: React.CSSProperties = {
  backgroundColor: '#3b82f6',
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

const fallbackText: React.CSSProperties = {
  fontSize: '13px',
  color: '#6b7280',
  textAlign: 'center',
  margin: '0',
}

const fallbackLink: React.CSSProperties = {
  color: '#3b82f6',
  textDecoration: 'underline',
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
