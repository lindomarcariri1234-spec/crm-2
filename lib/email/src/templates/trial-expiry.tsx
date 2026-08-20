import * as React from "react";
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Hr,
  Section,
  Text,
} from "@react-email/components";

export interface TrialExpiryEmailProps {
  agencyName: string;
  trialEndsAt: string;
  upgradeUrl: string;
  supportEmail: string;
  expired: boolean;
}

export function TrialExpiryEmail({
  agencyName,
  trialEndsAt,
  upgradeUrl,
  supportEmail,
  expired,
}: TrialExpiryEmailProps) {
  const title = expired ? "Seu período de teste terminou" : "Seu período de teste está terminando";
  const accentColor = expired ? "#dc2626" : "#d97706";

  return (
    <Html>
      <Head />
      <Body style={main}>
        <Container style={container}>
          <Section style={{ ...header, backgroundColor: accentColor }}>
            <div style={icon}>{expired ? "⏰" : "⚠️"}</div>
            <Heading style={headerTitle}>{title}</Heading>
            <Text style={headerSubtitle}>
              {expired
                ? "Escolha um plano para retomar o acesso à sua agência."
                : "Escolha um plano antes do fim do teste para não interromper suas operações."}
            </Text>
          </Section>

          <Section style={section}>
            <Text style={bodyText}>Olá, <strong>{agencyName}</strong>,</Text>
            <Text style={bodyText}>
              {expired
                ? <>o período de teste do VisiteCRM terminou em <strong>{trialEndsAt}</strong>. Para voltar a usar o sistema, selecione um plano.</>
                : <>o período de teste do VisiteCRM termina em <strong>{trialEndsAt}</strong>. Para continuar usando o sistema sem interrupções, selecione um plano antes dessa data.</>}
            </Text>
          </Section>

          <Section style={buttonSection}>
            <Button style={{ ...button, backgroundColor: accentColor }} href={upgradeUrl}>
              {expired ? "Escolher um plano e retomar acesso" : "Escolher um plano"}
            </Button>
          </Section>

          <Section style={supportSection}>
            <Text style={supportText}>
              Precisa de ajuda? Fale com nossa equipe em{" "}
              <a href={`mailto:${supportEmail}`} style={supportLink}>{supportEmail}</a>.
            </Text>
          </Section>

          <Hr style={divider} />
          <Section style={footer}>
            <Text style={footerText}>VisiteCRM</Text>
            <Text style={footerSubtext}>Plataforma de gestão para agências de turismo</Text>
            <Text style={footerSubtext}>Esta é uma notificação automática.</Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const main: React.CSSProperties = {
  backgroundColor: "#f6f9fc",
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  maxWidth: "600px",
  padding: "20px 0",
};

const header: React.CSSProperties = {
  borderRadius: "8px 8px 0 0",
  padding: "36px 24px",
  textAlign: "center",
};

const icon: React.CSSProperties = {
  display: "block",
  fontSize: "42px",
  marginBottom: "10px",
};

const headerTitle: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "26px",
  fontWeight: "bold",
  margin: "0 0 8px",
};

const headerSubtitle: React.CSSProperties = {
  color: "#ffffff",
  fontSize: "15px",
  lineHeight: "1.5",
  margin: "0",
};

const section: React.CSSProperties = {
  padding: "28px 24px 8px",
};

const bodyText: React.CSSProperties = {
  color: "#4b5563",
  fontSize: "15px",
  lineHeight: "1.7",
  margin: "0 0 12px",
};

const buttonSection: React.CSSProperties = {
  padding: "18px 24px 28px",
  textAlign: "center",
};

const button: React.CSSProperties = {
  borderRadius: "8px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "16px",
  fontWeight: "700",
  padding: "14px 24px",
  textDecoration: "none",
};

const supportSection: React.CSSProperties = {
  backgroundColor: "#f9fafb",
  margin: "0 24px 24px",
  padding: "16px",
  textAlign: "center",
};

const supportText: React.CSSProperties = {
  color: "#4b5563",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0",
};

const supportLink: React.CSSProperties = {
  color: "#1d4ed8",
  fontWeight: "600",
};

const divider: React.CSSProperties = {
  borderColor: "#e5e7eb",
  margin: "0",
};

const footer: React.CSSProperties = {
  padding: "24px",
  textAlign: "center",
};

const footerText: React.CSSProperties = {
  color: "#374151",
  fontSize: "15px",
  fontWeight: "700",
  margin: "0 0 6px",
};

const footerSubtext: React.CSSProperties = {
  color: "#6b7280",
  fontSize: "12px",
  margin: "0 0 4px",
};