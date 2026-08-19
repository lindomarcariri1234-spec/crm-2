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

export interface FavoriteLowAvailabilityEmailProps {
  clientName: string
  clientEmail: string
  agencyName: string
  agencyEmail: string
  agencyPhone: string
  tripName: string
  tripDestination: string
  departureDate: string
  availableSeats: number
  tripUrl: string
}

export function FavoriteLowAvailabilityEmail({
  clientName,
  agencyName,
  agencyEmail,
  agencyPhone,
  tripName,
  tripDestination,
  departureDate,
  availableSeats,
  tripUrl,
}: FavoriteLowAvailabilityEmailProps) {
  const firstName = clientName.split(' ')[0]

  return (
    <Html lang="pt-BR">
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={emoji}>⚠️</Text>
            <Heading style={h1}>Poucas vagas restantes!</Heading>
            <Text style={subtitle}>
              Uma viagem que você favoritou está quase esgotada.
            </Text>
          </Section>

          <Section style={content}>
            <Text style={paragraph}>
              Olá, {firstName}! Você adicionou a viagem abaixo aos seus favoritos.
              Restam apenas <strong>{availableSeats} {availableSeats === 1 ? 'vaga' : 'vagas'}</strong> — não perca essa oportunidade!
            </Text>

            <Section style={tripBox}>
              <Text style={tripLabel}>Viagem favoritada</Text>
              <Text style={tripName_style}>{tripName}</Text>
              <Text style={tripDetail}>📍 {tripDestination}</Text>
              <Text style={tripDetail}>📅 {departureDate}</Text>
              <Section style={seatsWarning}>
                <Text style={seatsText}>
                  🔥 Apenas {availableSeats} {availableSeats === 1 ? 'vaga restante' : 'vagas restantes'}
                </Text>
              </Section>
            </Section>

            <Button style={button} href={tripUrl}>
              Garantir Minha Vaga Agora
            </Button>

            <Text style={paragraph}>
              Não deixe para depois — quando as vagas acabarem, não haverá como garantir o seu lugar nesta viagem.
            </Text>
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={footerText}>
              {agencyName} • {agencyPhone} • {agencyEmail}
            </Text>
            <Text style={footerText}>
              Você recebeu este aviso porque favoritou esta viagem no portal do cliente.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  )
}

const body: React.CSSProperties = {
  backgroundColor: '#f9fafb',
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
}

const container: React.CSSProperties = {
  maxWidth: '600px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  overflow: 'hidden',
  boxShadow: '0 4px 6px rgba(0,0,0,0.07)',
}

const header: React.CSSProperties = {
  background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  padding: '48px 40px',
  textAlign: 'center',
}

const emoji: React.CSSProperties = {
  fontSize: '56px',
  margin: '0 0 16px',
  lineHeight: '1',
}

const h1: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '28px',
  fontWeight: '700',
  margin: '0 0 12px',
  lineHeight: '1.3',
}

const subtitle: React.CSSProperties = {
  color: 'rgba(255,255,255,0.9)',
  fontSize: '16px',
  margin: '0',
  lineHeight: '1.6',
}

const content: React.CSSProperties = {
  padding: '40px',
}

const paragraph: React.CSSProperties = {
  color: '#374151',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '0 0 24px',
}

const tripBox: React.CSSProperties = {
  backgroundColor: '#fffbeb',
  border: '2px solid #f59e0b',
  borderRadius: '12px',
  padding: '24px 32px',
  margin: '0 0 32px',
}

const tripLabel: React.CSSProperties = {
  color: '#92400e',
  fontSize: '12px',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  margin: '0 0 8px',
}

const tripName_style: React.CSSProperties = {
  color: '#1f2937',
  fontSize: '22px',
  fontWeight: '700',
  margin: '0 0 12px',
  lineHeight: '1.3',
}

const tripDetail: React.CSSProperties = {
  color: '#4b5563',
  fontSize: '15px',
  margin: '0 0 6px',
  lineHeight: '1.5',
}

const seatsWarning: React.CSSProperties = {
  backgroundColor: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: '8px',
  padding: '10px 16px',
  marginTop: '16px',
}

const seatsText: React.CSSProperties = {
  color: '#dc2626',
  fontSize: '15px',
  fontWeight: '700',
  margin: '0',
  textAlign: 'center',
}

const button: React.CSSProperties = {
  backgroundColor: '#f59e0b',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  borderRadius: '8px',
  padding: '14px 32px',
  textDecoration: 'none',
  display: 'inline-block',
  marginBottom: '24px',
}

const hr: React.CSSProperties = {
  borderColor: '#e5e7eb',
  margin: '0',
}

const footer: React.CSSProperties = {
  padding: '24px 40px',
  textAlign: 'center',
}

const footerText: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: '13px',
  margin: '0 0 6px',
  lineHeight: '1.5',
}
