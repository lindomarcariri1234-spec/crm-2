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

export interface ReferralBonusPaidEmailProps {
  referrerName: string
  referrerEmail: string
  bonusAmount: number
  paidDate: string
  agencyName: string
  agencyLogo?: string | null
}

export function ReferralBonusPaidEmail({
  referrerName,
  bonusAmount,
  paidDate,
  agencyName,
  agencyLogo,
}: ReferralBonusPaidEmailProps) {
  const firstName = referrerName.split(' ')[0]

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={header}>
            <div style={iconWrap}>💰</div>
            <Heading style={headerTitle}>Bônus de Indicação Pago!</Heading>
            <Text style={headerSubtitle}>
              Seu bônus foi confirmado e está disponível.
            </Text>
          </Section>

          {/* GREETING */}
          <Section style={section}>
            <Text style={bodyText}>
              Olá, <strong>{firstName}</strong>!
            </Text>
            <Text style={bodyText}>
              A <strong>{agencyName}</strong> confirmou o pagamento do seu bônus de indicação.
              Obrigado por continuar indicando nossos serviços!
            </Text>
          </Section>

          <Hr style={divider} />

          {/* BONUS VALUE */}
          <Section style={section}>
            <Heading style={sectionTitle}>🎁 Seu Bônus</Heading>
            <div style={bonusBox}>
              <Text style={bonusAmount_}>
                R$ {bonusAmount.toFixed(2).replace('.', ',')}
              </Text>
              <Text style={bonusDate}>Pago em {paidDate}</Text>
            </div>
          </Section>

          <Hr style={divider} />

          {/* INCENTIVE */}
          <Section style={section}>
            <Text style={bodyText}>
              Continue compartilhando seu código de indicação e ganhe mais bônus a cada amigo que viajar com a gente!
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

const bonusBox: React.CSSProperties = {
  backgroundColor: '#f0fdf4',
  border: '2px solid #86efac',
  borderRadius: '12px',
  padding: '32px 24px',
  textAlign: 'center',
}

const bonusAmount_: React.CSSProperties = {
  fontSize: '40px',
  fontWeight: 'bold',
  color: '#16a34a',
  margin: '0 0 8px',
  letterSpacing: '-1px',
}

const bonusDate: React.CSSProperties = {
  fontSize: '14px',
  color: '#15803d',
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
