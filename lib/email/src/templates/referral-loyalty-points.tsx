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

export interface ReferralLoyaltyPointsEmailProps {
  referrerName: string
  referrerEmail: string
  pointsEarned: number
  currentBalance: number
  agencyName: string
  agencyLogo?: string | null
  profileUrl?: string
}

export function ReferralLoyaltyPointsEmail({
  referrerName,
  pointsEarned,
  currentBalance,
  agencyName,
  agencyLogo,
  profileUrl,
}: ReferralLoyaltyPointsEmailProps) {
  const firstName = referrerName.split(' ')[0]

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={header}>
            <div style={iconWrap}>⭐</div>
            <Heading style={headerTitle}>Pontos creditados!</Heading>
            <Text style={headerSubtitle}>
              Você ganhou pontos de fidelidade pela sua indicação.
            </Text>
          </Section>

          {/* GREETING */}
          <Section style={section}>
            <Text style={bodyText}>
              Olá, <strong>{firstName}</strong>!
            </Text>
            <Text style={bodyText}>
              Sua indicação foi convertida e você acaba de ganhar pontos de fidelidade.
              Acumule pontos para resgatar benefícios exclusivos com a <strong>{agencyName}</strong>.
            </Text>
          </Section>

          <Hr style={divider} />

          {/* POINTS SUMMARY */}
          <Section style={section}>
            <Heading style={sectionTitle}>⭐ Resumo de Pontos</Heading>
            <div style={pointsGrid}>
              <div style={pointsCard}>
                <Text style={cardLabel}>Pontos ganhos agora</Text>
                <Text style={cardValueEarned}>+{pointsEarned}</Text>
              </div>
              <div style={pointsCard}>
                <Text style={cardLabel}>Saldo total de pontos</Text>
                <Text style={cardValueBalance}>{currentBalance}</Text>
              </div>
            </div>
          </Section>

          <Hr style={divider} />

          {/* CALL TO ACTION */}
          <Section style={section}>
            <Text style={bodyText}>
              Continue indicando amigos e acumulando pontos para resgatar recompensas
              incríveis. Cada indicação vale pontos!
            </Text>
            {profileUrl && (
              <Button style={ctaButton} href={profileUrl}>
                🎒 Minhas Indicações
              </Button>
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
  color: '#fde68a',
  fontSize: '16px',
  margin: '0',
}

const section: React.CSSProperties = {
  padding: '32px 24px',
}

const ctaButton: React.CSSProperties = {
  backgroundColor: '#d97706',
  color: '#ffffff',
  padding: '12px 24px',
  borderRadius: '6px',
  fontSize: '15px',
  fontWeight: 'bold',
  textDecoration: 'none',
  display: 'inline-block',
  marginTop: '16px',
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

const pointsGrid: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
}

const pointsCard: React.CSSProperties = {
  flex: '1',
  backgroundColor: '#fffbeb',
  border: '2px solid #fcd34d',
  borderRadius: '12px',
  padding: '20px 16px',
  textAlign: 'center',
}

const cardLabel: React.CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
  fontWeight: '600',
  margin: '0 0 8px',
}

const cardValueEarned: React.CSSProperties = {
  fontSize: '36px',
  fontWeight: 'bold',
  color: '#d97706',
  margin: '0',
  letterSpacing: '-1px',
}

const cardValueBalance: React.CSSProperties = {
  fontSize: '36px',
  fontWeight: 'bold',
  color: '#92400e',
  margin: '0',
  letterSpacing: '-1px',
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
