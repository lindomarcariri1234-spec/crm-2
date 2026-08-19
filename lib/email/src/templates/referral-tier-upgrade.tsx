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

export interface ReferralTierUpgradeEmailProps {
  referrerName: string
  referrerEmail: string
  newTierLabel: string
  newTierLevel: string
  bonusMultiplier: number
  agencyName: string
  agencyLogo?: string | null
}

export function ReferralTierUpgradeEmail({
  referrerName,
  newTierLabel,
  newTierLevel,
  bonusMultiplier,
  agencyName,
  agencyLogo,
}: ReferralTierUpgradeEmailProps) {
  const firstName = referrerName.split(' ')[0]
  const multiplierText = bonusMultiplier > 1
    ? `${bonusMultiplier}x o bônus base`
    : 'bônus padrão'

  const tierColors: Record<string, string> = {
    bronze: '#b45309',
    silver: '#475569',
    gold: '#b45309',
    diamond: '#0e7490',
  }
  const headerColor = tierColors[newTierLevel] ?? '#7c3aed'

  const tierIcons: Record<string, string> = {
    bronze: '🥉',
    silver: '🥈',
    gold: '🥇',
    diamond: '💎',
  }
  const icon = tierIcons[newTierLevel] ?? '🏆'

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={{ ...header, backgroundColor: headerColor }}>
            <div style={iconWrap}>{icon}</div>
            <Heading style={headerTitle}>Você subiu de nível!</Heading>
            <Text style={headerSubtitle}>
              Bem-vindo ao tier <strong>{newTierLabel}</strong>
            </Text>
          </Section>

          {/* GREETING */}
          <Section style={section}>
            <Text style={bodyText}>
              Parabéns, <strong>{firstName}</strong>!
            </Text>
            <Text style={bodyText}>
              Suas indicações estão fazendo a diferença. Você acaba de alcançar o nível{' '}
              <strong>{newTierLabel}</strong> no programa de indicações da{' '}
              <strong>{agencyName}</strong>!
            </Text>
          </Section>

          <Hr style={divider} />

          {/* TIER BENEFIT */}
          <Section style={section}>
            <Heading style={sectionTitle}>{icon} Seu novo benefício</Heading>
            <div style={bonusBox}>
              <Text style={bonusLabel}>Multiplicador de bônus</Text>
              <Text style={bonusAmount}>{multiplierText}</Text>
              <Text style={bonusNote}>
                A partir de agora, cada indicação convertida rende{' '}
                {bonusMultiplier > 1 ? `${bonusMultiplier}x mais bônus` : 'o bônus padrão'}.
                Continue indicando para desbloquear ainda mais vantagens!
              </Text>
            </div>
          </Section>

          <Hr style={divider} />

          {/* INCENTIVE */}
          <Section style={section}>
            <Text style={bodyText}>
              Compartilhe seu código com mais amigos e continue acumulando indicações para subir
              ainda mais no ranking. Obrigado por fazer parte da nossa comunidade!
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
  color: 'rgba(255,255,255,0.9)',
  fontSize: '16px',
  margin: '0',
}

const section: React.CSSProperties = {
  padding: '32px 24px',
}

const sectionTitle: React.CSSProperties = {
  color: '#1f2937',
  fontSize: '18px',
  fontWeight: 'bold',
  margin: '0 0 16px',
}

const bodyText: React.CSSProperties = {
  color: '#374151',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '0 0 12px',
}

const bonusBox: React.CSSProperties = {
  backgroundColor: '#f3f4f6',
  borderRadius: '8px',
  padding: '24px',
  textAlign: 'center',
}

const bonusLabel: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '14px',
  margin: '0 0 8px',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
}

const bonusAmount: React.CSSProperties = {
  color: '#7c3aed',
  fontSize: '28px',
  fontWeight: 'bold',
  margin: '0 0 8px',
}

const bonusNote: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '14px',
  margin: '0',
}

const divider: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '0 24px',
}

const footer: React.CSSProperties = {
  padding: '24px',
  textAlign: 'center',
}

const footerLogo: React.CSSProperties = {
  maxHeight: '40px',
  maxWidth: '160px',
  margin: '0 auto 12px',
}

const footerText: React.CSSProperties = {
  color: '#374151',
  fontSize: '16px',
  fontWeight: 'bold',
  margin: '0 0 4px',
}

const footerSubtext: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '14px',
  margin: '0 0 16px',
}

const footerDivider: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '16px 0',
}

const footerCopyright: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: '12px',
  margin: '0 0 4px',
}

const footerDisclaimer: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: '12px',
  margin: '0',
}
