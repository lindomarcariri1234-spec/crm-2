const SUPPORTED_TEMPLATE_VARIABLES = ["nome"] as const;

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character] ?? character;
  });
}

export function extractTemplateVariables(content: string): string[] {
  return SUPPORTED_TEMPLATE_VARIABLES.filter((variable) =>
    new RegExp(`\\{${variable}\\}`, "i").test(content),
  );
}

export function resolveClientTemplate(
  content: string,
  clientName: string | null | undefined,
  htmlContent = false,
): string {
  const name = clientName?.trim();
  if (!name) return content;

  const replacement = htmlContent ? escapeHtmlText(name) : name;
  return content.replace(/\{nome\}/gi, () => replacement);
}

export function prepareManualOutboundContent(input: {
  emailContent: string;
  whatsappContent: string;
  clientName?: string | null;
}): { emailHtml: string; whatsappText: string } {
  return {
    emailHtml: resolveClientTemplate(input.emailContent.trim(), input.clientName, true),
    whatsappText: resolveClientTemplate(input.whatsappContent.trim(), input.clientName),
  };
}