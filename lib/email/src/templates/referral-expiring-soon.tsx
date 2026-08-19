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
  Button,
} from '@react-email/components'

export interface ReferralExpiringSoonEmailProps {
  referrerName: string
  referrerEmail: string
  referralCode: string
  expiresAt: string
  daysLeft: number
  agencyName: string
  agencyLogo?: string | null
  shareUrl?: string | null
}

export function ReferralExpiringSoonEmail({
  referrerName,
  referralCode,
  expiresAt,
  daysLeft,
  agencyName,
  agencyLogo,
  shareUrl,
}: ReferralExpiringSoonEmailProps) {
  const firstName = referrerName.split(' ')[0]
  const urgency = daysLeft <= 1 ? 'último dia' : `${daysLeft} dias`
  const headerColor = daysLeft <= 1 ? '#dc2626' : '#d97706'
  const icon = daysLeft <= 1 ? '🚨' : '⏰'

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={{ ...header, backgroundColor: headerColor }}>
            <div style={iconWrap}>{icon}</div>
            <Heading style={headerTitle}>
              {daysLeft <= 1
                ? 'Último dia para usar seu código!'
                : `Seu código expira em ${daysLeft} dias`}
            </Heading>
            <Text style={headerSubtitle}>
              Compartilhe agora e não perca seu bônus!
            </Text>
          </Section>

          {/* GREETING */}
          <Section style={section}>
            <Text style={bodyText}>
              Olá, <strong>{firstName}</strong>!
            </Text>
            <Text style={bodyText}>
              {daysLeft <= 1
                ? 'Atenção! Hoje é o último dia para que alguém use seu código de indicação.'
                : `Seu código de indicação vence em ${urgency}. Não deixe essa oportunidade passar!`}
            </Text>
          </Section>

          {/* CODE BOX */}
          <Section style={codeSection}>
            <Text style={codeLabel}>SEU CÓDIGO DE INDICAÇÃO</Text>
            <div style={codeBox}>
              <Text style={codeText}>{referralCode}</Text>
            </div>
            <Text style={codeExpiry}>Válido até {expiresAt}</Text>
          </Section>

          <Hr style={divider} />

          {/* TIPS */}
          <Section style={section}>
            <Heading style={sectionTitle}>📲 Compartilhe agora e ganhe bônus</Heading>
            <div style={tipsList}>
              <div style={tipItem}>
                <span style={tipIcon}>💬</span>
                <span style={tipText}>Envie seu código pelo WhatsApp para amigos e familiares</span>
              </div>
              <div style={tipItem}>
                <span style={tipIcon}>📣</span>
                <span style={tipText}>Poste nas suas redes sociais — mais pessoas, mais chances</span>
              </div>
              <div style={tipItem}>
                <span style={tipIcon}>🎁</span>
                <span style={tipText}>Quem usar seu código ganha desconto especial na viagem</span>
              </div>
            </div>
          </Section>

          <Hr style={divider} />

          <Section style={ctaSection}>
            <Text style={ctaText}>
              Compartilhe agora pelo WhatsApp com um clique!
            </Text>
            {shareUrl ? (
              <Button href={shareUrl} style={ctaButton}>
                📲 Compartilhar no WhatsApp
              </Button>
            ) : (
              <Text style={bodyText}>
                Copie o código acima e envie para quem você quiser!
              </Text>
            )}
          </Section>

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
              Você está recebendo este e-mail porque participa do programa de indicações.
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
  fontSize: '26px',
  fontWeight: 'bold',
  margin: '0 0 8px',
}

const headerSubtitle: React.CSSProperties = {
  color: '#fef3c7',
  fontSize: '16px',
  margin: '0',
}

const section: React.CSSProperties = {
  padding: '32px 24px',
}

const ctaSection: React.CSSProperties = {
  padding: '24px 24px 32px',
  textAlign: 'center',
}

const ctaText: React.CSSProperties = {
  fontSize: '15px',
  color: '#4b5563',
  margin: '0 0 16px',
}

const ctaButton: React.CSSProperties = {
  backgroundColor: '#25d366',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  padding: '14px 32px',
  borderRadius: '8px',
  display: 'inline-block',
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

const codeSection: React.CSSProperties = {
  padding: '0 24px 24px',
  textAlign: 'center',
}

const codeLabel: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 'bold',
  letterSpacing: '1px',
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  margin: '0 0 8px',
}

const codeBox: React.CSSProperties = {
  backgroundColor: '#fffbeb',
  border: '2px dashed #f59e0b',
  borderRadius: '8px',
  padding: '16px 24px',
  display: 'inline-block',
  margin: '0 auto 8px',
}

const codeText: React.CSSProperties = {
  fontSize: '28px',
  fontWeight: 'bold',
  letterSpacing: '4px',
  color: '#92400e',
  fontFamily: 'monospace',
  margin: '0',
}

const codeExpiry: React.CSSProperties = {
  fontSize: '13px',
  color: '#9ca3af',
  margin: '4px 0 0',
}

const tipsList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: '10px',
}

const tipItem: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '12px',
  fontSize: '14px',
  color: '#374151',
  padding: '12px',
  backgroundColor: '#fffbeb',
  borderRadius: '8px',
  border: '1px solid #fde68a',
}

const tipIcon: React.CSSProperties = {
  fontSize: '18px',
  flexShrink: 0,
}

const tipText: React.CSSProperties = {
  fontSize: '14px',
  color: '#374151',
  lineHeight: '1.5',
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
