import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockProxy = vi.fn();

import { createApiKeyResend, createConnectorResend } from "../../../../lib/email/src/resend-transport.js";

const message = {
  from: "CRM <sender@unverified.example>",
  to: ["recipient@example.com"],
  subject: "Test message",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RESEND_API_KEY", "");
  vi.stubEnv("RESEND_FROM_EMAIL", "");
  vi.stubEnv("NODE_ENV", "development");
});


afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Replit Resend connector transport", () => {
  it("sends through the connector and uses the safe development sender", async () => {
    mockProxy.mockResolvedValue(new Response(JSON.stringify({ id: "email_123" }), { status: 200 }));

    const result = await createConnectorResend({ proxy: mockProxy }).emails.send({
      ...message,
      html: "<p>Hello</p>",
    });

    expect(result).toEqual({ data: { id: "email_123" }, error: null });
    expect(mockProxy).toHaveBeenCalledWith("resend", "/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.objectContaining({
        from: "VisiteCRM <onboarding@resend.dev>",
        html: "<p>Hello</p>",
      }),
    });
  });

  it("forwards the stable idempotency key to the Resend connector", async () => {
    mockProxy.mockResolvedValue(new Response(JSON.stringify({ id: "email_idempotent" }), { status: 200 }));

    await createConnectorResend({ proxy: mockProxy }).emails.send(
      { ...message, html: "<p>Hello</p>" },
      { idempotencyKey: "outbound:tenant-a:delivery-1" },
    );

    expect(mockProxy).toHaveBeenCalledWith("resend", "/emails", expect.objectContaining({
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "outbound:tenant-a:delivery-1",
      },
    }));
  });

  it("returns the provider's error message instead of throwing", async () => {
    mockProxy.mockResolvedValue(
      new Response(JSON.stringify({ message: "The sender domain is not verified" }), { status: 403 }),
    );

    const result = await createConnectorResend({ proxy: mockProxy }).emails.send({
      ...message,
      html: "<p>Hello</p>",
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("The sender domain is not verified");
  });

  it("renders React templates to HTML and serializes binary attachments", async () => {
    mockProxy.mockResolvedValue(new Response(JSON.stringify({ id: "email_456" }), { status: 200 }));
    const reactElement = {
      $$typeof: Symbol.for("react.transitional.element"),
      type: "p",
      key: null,
      props: { children: "A rendered template" },
    };

    await createConnectorResend({ proxy: mockProxy }).emails.send({
      ...message,
      react: reactElement,
      attachments: [{ filename: "receipt.txt", content: Buffer.from("receipt") }],
    });

    const request = mockProxy.mock.calls[0]?.[2] as { body: Record<string, unknown> };
    expect(request.body.html).toContain("<p>A rendered template</p>");
    expect(request.body.attachments).toEqual([
      { filename: "receipt.txt", content: Buffer.from("receipt").toString("base64") },
    ]);
  });

  it("uses the configured verified sender when one is supplied", async () => {
    vi.stubEnv("RESEND_FROM_EMAIL", "VisiteCRM <noreply@verified.example>");
    mockProxy.mockResolvedValue(new Response(JSON.stringify({ id: "email_789" }), { status: 200 }));

    await createConnectorResend({ proxy: mockProxy }).emails.send({ ...message, text: "Hello" });

    const request = mockProxy.mock.calls[0]?.[2] as { body: Record<string, unknown> };
    expect(request.body.from).toBe("VisiteCRM <noreply@verified.example>");
  });

  it("refuses production delivery when no sender is configured", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const result = await createConnectorResend({ proxy: mockProxy }).emails.send({
      ...message,
      text: "Hello",
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("RESEND_FROM_EMAIL must be configured in production");
    expect(mockProxy).not.toHaveBeenCalled();
  });

  it("uses the configured sender with a direct Resend API key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RESEND_FROM_EMAIL", "VisiteCRM <reservas@resend.visitecrm.com>");
    const mockSend = vi.fn().mockResolvedValue({ data: { id: "email_direct_123" }, error: null });
    const directClient = { emails: { send: mockSend } } as unknown as Parameters<typeof createApiKeyResend>[1];

    const result = await createApiKeyResend("re_test", directClient).emails.send({
      ...message,
      text: "Hello",
    });

    expect(result).toEqual({ data: { id: "email_direct_123" }, error: null });
    expect(mockSend).toHaveBeenCalledWith({
      ...message,
      text: "Hello",
      from: "VisiteCRM <reservas@resend.visitecrm.com>",
    });
  });

  it("refuses direct API key delivery in production without a configured sender", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const mockSend = vi.fn();
    const directClient = { emails: { send: mockSend } } as unknown as Parameters<typeof createApiKeyResend>[1];

    const result = await createApiKeyResend("re_test", directClient).emails.send({
      ...message,
      text: "Hello",
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toBe("RESEND_FROM_EMAIL must be configured in production");
    expect(mockSend).not.toHaveBeenCalled();
  });
});