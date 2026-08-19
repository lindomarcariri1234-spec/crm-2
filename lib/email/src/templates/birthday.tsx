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

export interface BirthdayEmailProps {
  clientName: string
  clientEmail: string
  agencyName: string
  agencyEmail: string
  agencyPhone: string
  couponCode: string
  discountPercent: number
  validUntil: string
  customMessage?: string | null
}

export function BirthdayEmail({
  clientName,
  agencyName,
  agencyEmail,
  agencyPhone,
  couponCode,
  discountPercent,
  validUntil,
  customMessage,
}: BirthdayEmailProps) {
  const firstName = clientName.split(' ')[0]

  return (
    <Html lang="pt-BR">
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            <Text style={emoji}>🎂</Text>
            <Heading style={h1}>Feliz Aniversário, {firstName}!</Heading>
            <Text style={subtitle}>
              A equipe da {agencyName} deseja um dia repleto de alegria e realizações!
            </Text>
          </Section>

          <Section style={content}>
            <Text style={paragraph}>
              {customMessage
                ? customMessage
                : `Em comemoração ao seu aniversário, preparamos um presente especial para você:`}
            </Text>

            <Section style={couponBox}>
              <Text style={couponLabel}>Seu cupom de desconto exclusivo</Text>
              <Text style={couponCode_style}>{couponCode}</Text>
              <Text style={couponValue}>{discountPercent}% de desconto</Text>
              <Text style={couponValidity}>Válido até {validUntil}</Text>
            </Section>

            <Text style={paragraph}>
              Use este cupom para garantir um desconto especial na sua próxima aventura conosco.
              Que tal planejar a viagem dos seus sonhos como presente de aniversário?
            </Text>

            <Button style={button} href={`mailto:${agencyEmail}`}>
              Quero Reservar Minha Viagem
            </Button>
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={footerText}>
              {agencyName} • {agencyPhone} • {agencyEmail}
            </Text>
            <Text style={footerText}>
              Este cupom é de uso único e intransferível, válido até {validUntil}.
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
  background: 'linear-gradient(135deg, #ec4899 0%, #f43f5e 100%)',
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

const couponBox: React.CSSProperties = {
  backgroundColor: '#fdf2f8',
  border: '2px dashed #ec4899',
  borderRadius: '12px',
  padding: '32px',
  textAlign: 'center',
  margin: '0 0 32px',
}

const couponLabel: React.CSSProperties = {
  color: '#be185d',
  fontSize: '13px',
  fontWeight: '600',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  margin: '0 0 12px',
}

const couponCode_style: React.CSSProperties = {
  color: '#ec4899',
  fontSize: '32px',
  fontWeight: '800',
  letterSpacing: '0.15em',
  fontFamily: 'monospace',
  margin: '0 0 8px',
}

const couponValue: React.CSSProperties = {
  color: '#be185d',
  fontSize: '20px',
  fontWeight: '700',
  margin: '0 0 8px',
}

const couponValidity: React.CSSProperties = {
  color: '#9ca3af',
  fontSize: '13px',
  margin: '0',
}

const button: React.CSSProperties = {
  backgroundColor: '#ec4899',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '600',
  borderRadius: '8px',
  padding: '14px 32px',
  textDecoration: 'none',
  display: 'inline-block',
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
