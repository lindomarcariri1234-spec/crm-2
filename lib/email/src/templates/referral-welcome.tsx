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
  Link,
} from '@react-email/components'

export interface ReferralWelcomeEmailProps {
  referrerName: string
  referrerEmail: string
  referralCode: string
  referralLink: string
  whatsappShareUrl?: string | null
  bonusValue: number
  discountValue: number
  agencyName: string
  agencyLogo?: string | null
}

export function ReferralWelcomeEmail({
  referrerName,
  referralCode,
  referralLink,
  whatsappShareUrl,
  bonusValue,
  discountValue,
  agencyName,
  agencyLogo,
}: ReferralWelcomeEmailProps) {
  const firstName = referrerName.split(' ')[0]

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>

          {/* HEADER */}
          <Section style={header}>
            <div style={iconWrap}>🎁</div>
            <Heading style={headerTitle}>Seu código de indicação está pronto!</Heading>
            <Text style={headerSubtitle}>
              Comece a indicar e ganhe bônus a cada amigo que viajar.
            </Text>
          </Section>

          {/* GREETING */}
          <Section style={section}>
            <Text style={bodyText}>
              Olá, <strong>{firstName}</strong>!
            </Text>
            <Text style={bodyText}>
              A <strong>{agencyName}</strong> tem uma novidade especial para você: seu código
              exclusivo de indicação já está ativo. Compartilhe com amigos e familia e ganhe
              bônus a cada nova reserva confirmada!
            </Text>
          </Section>

          <Hr style={divider} />

          {/* CODE HIGHLIGHT */}
          <Section style={section}>
            <Heading style={sectionTitle}>🔑 Seu Código Exclusivo</Heading>
            <div style={codeBox}>
              <Text style={codeLabel}>Código de indicação</Text>
              <Text style={codeText}>{referralCode}</Text>
            </div>
          </Section>

          {/* HOW IT WORKS */}
          <Section style={howItWorksSection}>
            <Heading style={sectionTitle}>Como funciona?</Heading>
            <div style={stepRow}>
              <Text style={stepNumber}>1</Text>
              <Text style={stepText}>
                <strong>Compartilhe</strong> — Envie seu link ou código para amigos e família.
              </Text>
            </div>
            <div style={stepRow}>
              <Text style={stepNumber}>2</Text>
              <Text style={stepText}>
                <strong>Desconto garantido</strong> — Seu indicado recebe{' '}
                {discountValue > 0 ? `${discountValue}% de desconto` : 'desconto especial'} na primeira compra.
              </Text>
            </div>
            <div style={stepRow}>
              <Text style={stepNumber}>3</Text>
              <Text style={stepText}>
                <strong>Você ganha bônus</strong> — Receba{' '}
                {bonusValue > 0
                  ? `R$ ${bonusValue.toFixed(2).replace('.', ',')}`
                  : 'bônus exclusivo'}{' '}
                quando a viagem for confirmada.
              </Text>
            </div>
          </Section>

          <Hr style={divider} />

          {/* CTA BUTTONS */}
          <Section style={ctaSection}>
            {whatsappShareUrl && (
              <Link href={whatsappShareUrl} style={whatsappButton}>
                📱 Compartilhar no WhatsApp
              </Link>
            )}
            <Link href={referralLink} style={linkButton}>
              🔗 Copiar meu link de indicação
            </Link>
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
              Você está recebendo este email porque realizou uma reserva e foi cadastrado no
              programa de indicações.
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
  backgroundColor: '#7c3aed',
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
  color: '#ddd6fe',
  fontSize: '16px',
  margin: '0',
}

const section: React.CSSProperties = {
  padding: '32px 24px',
}

const howItWorksSection: React.CSSProperties = {
  padding: '8px 24px 32px',
}

const ctaSection: React.CSSProperties = {
  padding: '24px',
  textAlign: 'center',
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

const codeBox: React.CSSProperties = {
  backgroundColor: '#faf5ff',
  border: '2px dashed #c4b5fd',
  borderRadius: '12px',
  padding: '24px',
  textAlign: 'center',
}

const codeLabel: React.CSSProperties = {
  fontSize: '12px',
  color: '#6b7280',
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
  fontWeight: '600',
  margin: '0 0 8px',
}

const codeText: React.CSSProperties = {
  fontSize: '36px',
  fontWeight: 'bold',
  color: '#7c3aed',
  letterSpacing: '3px',
  margin: '0',
  fontFamily: 'monospace',
}

const stepRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  marginBottom: '16px',
}

const stepNumber: React.CSSProperties = {
  backgroundColor: '#7c3aed',
  color: '#ffffff',
  borderRadius: '50%',
  width: '28px',
  height: '28px',
  lineHeight: '28px',
  textAlign: 'center',
  fontWeight: 'bold',
  fontSize: '14px',
  flexShrink: 0,
  marginRight: '12px',
  margin: '0 12px 0 0',
}

const stepText: React.CSSProperties = {
  fontSize: '14px',
  color: '#4b5563',
  lineHeight: '1.6',
  margin: '4px 0 0',
}

const whatsappButton: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#16a34a',
  color: '#ffffff',
  padding: '14px 28px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontWeight: 'bold',
  fontSize: '16px',
  margin: '0 8px 12px',
}

const linkButton: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#7c3aed',
  color: '#ffffff',
  padding: '14px 28px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontWeight: 'bold',
  fontSize: '16px',
  margin: '0 8px 12px',
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
