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
} from '@react-email/components'

export interface LoyaltyTierUpgradeEmailProps {
  clientName: string
  clientEmail: string
  newTierLabel: string
  totalPoints: number
  nextTierLabel: string | null
  pointsToNext: number | null
  agencyName: string
}

export function LoyaltyTierUpgradeEmail({
  clientName,
  newTierLabel,
  totalPoints,
  nextTierLabel,
  pointsToNext,
  agencyName,
}: LoyaltyTierUpgradeEmailProps) {
  const firstName = clientName.split(' ')[0]
  const nextGoalText = nextTierLabel && pointsToNext !== null
    ? `Faltam ${pointsToNext.toLocaleString('pt-BR')} pontos para chegar ao nível ${nextTierLabel}.`
    : 'Você atingiu o nível máximo do programa de fidelidade!'

  return (
    <Html lang="pt-BR">
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={emoji}>🎉</Text>
            <Heading style={h1}>Você subiu de nível!</Heading>
            <Text style={subtitle}>
              Parabéns por essa conquista no programa de fidelidade da {agencyName}.
            </Text>
          </Section>

          <Section style={content}>
            <Text style={paragraph}>Parabéns, {firstName}!</Text>
            <Text style={paragraph}>
              Você acaba de alcançar o nível <strong>{newTierLabel}</strong> no programa de
              fidelidade da <strong>{agencyName}</strong>.
            </Text>

            <Section style={pointsBox}>
              <Text style={label}>Seu novo nível</Text>
              <Text style={tier}>{newTierLabel}</Text>
              <Text style={label}>Pontos acumulados</Text>
              <Text style={points}>{totalPoints.toLocaleString('pt-BR')} pts</Text>
            </Section>

            <Text style={nextGoalStyle}>{nextGoalText}</Text>
            <Text style={paragraph}>
              Continue viajando com a gente para aproveitar ainda mais benefícios.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={footerText}>{agencyName}</Text>
            <Text style={footerText}>
              Você está recebendo este email porque participa do programa de fidelidade.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const body: React.CSSProperties = {
  backgroundColor: '#f6f9fc',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif',
}

const container: React.CSSProperties = {
  maxWidth: '600px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  overflow: 'hidden',
}

const header: React.CSSProperties = {
  backgroundColor: '#d97706',
  padding: '40px 32px',
  textAlign: 'center',
}

const emoji: React.CSSProperties = {
  fontSize: '48px',
  margin: '0 0 12px',
}

const h1: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '28px',
  margin: '0 0 10px',
}

const subtitle: React.CSSProperties = {
  color: '#fef3c7',
  fontSize: '16px',
  lineHeight: '1.5',
  margin: '0',
}

const content: React.CSSProperties = {
  padding: '40px 32px',
}

const paragraph: React.CSSProperties = {
  color: '#374151',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '0 0 20px',
}

const pointsBox: React.CSSProperties = {
  backgroundColor: '#fffbeb',
  border: '2px solid #fcd34d',
  borderRadius: '12px',
  padding: '24px',
  textAlign: 'center',
  margin: '28px 0',
}

const label: React.CSSProperties = {
  color: '#92400e',
  fontSize: '13px',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  margin: '0 0 8px',
}

const tier: React.CSSProperties = {
  color: '#b45309',
  fontSize: '30px',
  fontWeight: '700',
  margin: '0 0 20px',
}

const points: React.CSSProperties = {
  color: '#92400e',
  fontSize: '28px',
  fontWeight: '700',
  margin: '0',
}

const nextGoalStyle: React.CSSProperties = {
  color: '#4b5563',
  fontSize: '15px',
  lineHeight: '1.6',
  margin: '0 0 24px',
  textAlign: 'center',
}

const hr: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '0',
}

const footer: React.CSSProperties = {
  padding: '24px 32px',
  textAlign: 'center',
}

const footerText: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: '13px',
  lineHeight: '1.5',
  margin: '0 0 6px',
}