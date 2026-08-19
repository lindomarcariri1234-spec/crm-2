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

export interface ReferralExpiredEmailProps {
  referrerName: string
  referrerEmail: string
  agencyName: string
  agencyLogo?: string | null
}

export function ReferralExpiredEmail({
  referrerName,
  agencyName,
  agencyLogo,
}: ReferralExpiredEmailProps) {
  const firstName = referrerName.split(' ')[0]

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={header}>
            <div style={iconWrap}>⏰</div>
            <Heading style={headerTitle}>Sua indicação expirou</Heading>
            <Text style={headerSubtitle}>
              Mas você pode gerar um novo código agora mesmo!
            </Text>
          </Section>

          {/* GREETING */}
          <Section style={section}>
            <Text style={bodyText}>
              Olá, <strong>{firstName}</strong>!
            </Text>
            <Text style={bodyText}>
              Infelizmente seu código de indicação expirou sem que ninguém o utilizasse.
              Mas não desanime — você pode compartilhar um novo código e continuar ganhando bônus!
            </Text>
          </Section>

          <Hr style={divider} />

          {/* TIPS */}
          <Section style={section}>
            <Heading style={sectionTitle}>💡 Dicas para indicar com sucesso</Heading>
            <div style={tipsList}>
              <div style={tipItem}>
                <span style={tipIcon}>📱</span>
                <span style={tipText}>Envie seu código por WhatsApp para amigos e familiares</span>
              </div>
              <div style={tipItem}>
                <span style={tipIcon}>📣</span>
                <span style={tipText}>Compartilhe nas redes sociais com uma foto de uma viagem que você amou</span>
              </div>
              <div style={tipItem}>
                <span style={tipIcon}>🎯</span>
                <span style={tipText}>Indique pessoas que já comentaram que querem viajar</span>
              </div>
            </div>
          </Section>

          <Hr style={divider} />

          <Section style={section}>
            <Text style={bodyText}>
              Acesse sua Área do Cliente para pegar seu novo código de indicação e começar a compartilhar agora mesmo!
            </Text>
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
              Você está recebendo este email porque participa do programa de indicações.
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
  backgroundColor: '#d97706',
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
  color: '#fef3c7',
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
