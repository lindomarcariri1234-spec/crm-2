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

export interface NpsSurveyEmailProps {
  clientName: string
  clientEmail: string
  agencyName: string
  agencyLogo?: string | null
  tripName: string
  returnDate: string
  surveyBaseUrl: string
  token: string
  /** Optional client portal URL. When provided, a CTA button linking to the
   *  portal's /perfil page is shown so the client can also rate through the app. */
  portalUrl?: string | null
}

export function NpsSurveyEmail({
  clientName,
  agencyName,
  agencyLogo,
  tripName,
  surveyBaseUrl,
  token,
  portalUrl,
}: NpsSurveyEmailProps) {
  const firstName = clientName.split(' ')[0]
  const scores = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  function scoreColor(s: number): string {
    if (s >= 9) return '#16a34a'
    if (s >= 7) return '#ca8a04'
    return '#dc2626'
  }

  return (
    <Html lang="pt-BR">
      <Head />
      <Body style={body}>
        <Container style={container}>
          <Section style={header}>
            {agencyLogo ? (
              <img src={agencyLogo} alt={agencyName} style={logoStyle} />
            ) : (
              <Text style={agencyNameStyle}>{agencyName}</Text>
            )}
          </Section>

          <Section style={content}>
            <Heading style={h1}>Como foi sua viagem, {firstName}?</Heading>
            <Text style={paragraph}>
              Você acabou de voltar de <strong>{tripName}</strong> com a <strong>{agencyName}</strong>.
              Gostaríamos muito de saber o que você achou!
            </Text>

            <Text style={questionText}>
              Em uma escala de 0 a 10, qual a probabilidade de você recomendar
              a <strong>{agencyName}</strong> para um amigo ou familiar?
            </Text>

            <Section style={scaleContainer}>
              <table width="100%" cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                <tbody>
                  <tr>
                    {scores.map(s => (
                      <td key={s} style={{ padding: '3px', textAlign: 'center' as const }}>
                        <a
                          href={`${surveyBaseUrl}/api/nps/respond?token=${token}&score=${s}`}
                          style={{
                            display: 'inline-block',
                            width: '36px',
                            height: '36px',
                            lineHeight: '36px',
                            textAlign: 'center' as const,
                            borderRadius: '8px',
                            backgroundColor: scoreColor(s),
                            color: '#ffffff',
                            fontWeight: '700',
                            fontSize: '15px',
                            textDecoration: 'none',
                          }}
                        >
                          {s}
                        </a>
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
              <table width="100%" cellPadding={0} cellSpacing={0} style={{ marginTop: '8px' }}>
                <tbody>
                  <tr>
                    <td style={{ textAlign: 'left' as const }}>
                      <Text style={scaleLabel}>0 = Nada provável</Text>
                    </td>
                    <td style={{ textAlign: 'right' as const }}>
                      <Text style={scaleLabel}>10 = Muito provável</Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Text style={smallText}>
              Basta clicar no número que melhor representa sua opinião.
              A pesquisa leva menos de 30 segundos.
            </Text>

            {portalUrl ? (
              <Section style={portalSection}>
                <Text style={portalText}>
                  Prefere avaliar pelo app? Acesse sua área do cliente:
                </Text>
                <a
                  href={portalUrl}
                  style={portalButton}
                >
                  Acessar minha área do cliente
                </a>
              </Section>
            ) : null}
          </Section>

          <Hr style={hr} />

          <Section style={footer}>
            <Text style={footerText}>
              Esta pesquisa foi enviada por <strong>{agencyName}</strong>.
              Sua opinião é muito importante para continuarmos melhorando.
            </Text>
            <Text style={footerText}>
              Caso não queira receber mais pesquisas, ignore este e-mail.
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
  maxWidth: '560px',
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: '12px',
  overflow: 'hidden',
  boxShadow: '0 4px 6px rgba(0,0,0,0.07)',
}

const header: React.CSSProperties = {
  background: 'linear-gradient(135deg, #0f172a 0%, #1e40af 100%)',
  padding: '32px 40px',
  textAlign: 'center',
}

const logoStyle: React.CSSProperties = {
  maxHeight: '48px',
  maxWidth: '200px',
  objectFit: 'contain',
}

const agencyNameStyle: React.CSSProperties = {
  color: '#ffffff',
  fontSize: '22px',
  fontWeight: '700',
  margin: '0',
}

const content: React.CSSProperties = {
  padding: '40px',
}

const h1: React.CSSProperties = {
  color: '#0f172a',
  fontSize: '24px',
  fontWeight: '700',
  margin: '0 0 16px',
  lineHeight: '1.3',
}

const paragraph: React.CSSProperties = {
  color: '#374151',
  fontSize: '16px',
  lineHeight: '1.6',
  margin: '0 0 20px',
}

const questionText: React.CSSProperties = {
  color: '#374151',
  fontSize: '15px',
  lineHeight: '1.6',
  margin: '0 0 24px',
  padding: '16px',
  backgroundColor: '#f8fafc',
  borderRadius: '8px',
  borderLeft: '4px solid #1e40af',
}

const scaleContainer: React.CSSProperties = {
  margin: '0 0 20px',
}

const scaleLabel: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '12px',
  margin: '0',
}

const smallText: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '13px',
  lineHeight: '1.5',
  margin: '0',
  textAlign: 'center',
}

const portalSection: React.CSSProperties = {
  marginTop: '24px',
  textAlign: 'center',
}

const portalText: React.CSSProperties = {
  color: '#6b7280',
  fontSize: '13px',
  margin: '0 0 12px',
}

const portalButton: React.CSSProperties = {
  display: 'inline-block',
  backgroundColor: '#1e40af',
  color: '#ffffff',
  padding: '10px 24px',
  borderRadius: '8px',
  textDecoration: 'none',
  fontSize: '14px',
  fontWeight: '600',
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
  fontSize: '12px',
  margin: '0 0 4px',
  lineHeight: '1.5',
}
