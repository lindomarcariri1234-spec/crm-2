import { describe, it, expect, vi } from "vitest";

// ai-client pulls in db / drizzle / crypto / the managed AI client for its
// tenant-resolution helpers. The SSRF helpers under test only use node:net and
// node:dns, so we stub the heavy imports to keep this suite isolated and offline.
vi.mock("@workspace/db", () => ({ db: {}, aiIntegrationsTable: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("../lib/crypto", () => ({
  decryptCredential: vi.fn(),
  encryptCredential: vi.fn(),
}));
vi.mock("@workspace/integrations-openai-ai-server", () => ({ openai: {} }));

const { isPrivateIp, assertSafeUrl } = await import("../lib/ai-client");

describe("isPrivateIp", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "192.168.0.1",
    "172.16.5.5",
    "172.31.255.255",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "0.0.0.0",
    "224.0.0.1", // multicast
  ])("blocks private/reserved IPv4 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "93.184.216.34"])(
    "allows public IPv4 %s",
    (ip) => {
      expect(isPrivateIp(ip)).toBe(false);
    },
  );

  it.each([
    "::1", // loopback
    "::", // unspecified
    "fe80::1", // link-local
    "fc00::1", // unique-local
    "fd12:3456:789a::1", // unique-local
    "::ffff:127.0.0.1", // IPv4-mapped, dotted
    "::ffff:7f00:1", // IPv4-mapped, hex (the bypass)
    "::ffff:7f00:0001", // IPv4-mapped, padded hex
    "[::ffff:7f00:1]", // with URL brackets
    "::7f00:1", // IPv4-compatible (deprecated)
    "::ffff:a9fe:a9fe", // mapped 169.254.169.254 metadata
    "64:ff9b::7f00:1", // NAT64-embedded loopback
  ])("blocks private/reserved IPv6 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it.each([
    "2606:4700:4700::1111", // public (Cloudflare)
    "2001:4860:4860::8888", // public (Google)
    "::ffff:8.8.8.8", // mapped public, dotted
    "::ffff:0808:0808", // mapped public, hex
    "64:ff9b::8.8.8.8", // NAT64-embedded public
  ])("allows public IPv6 %s", (ip) => {
    expect(isPrivateIp(ip)).toBe(false);
  });

  it("treats unparseable input as unsafe", () => {
    expect(isPrivateIp("not-an-ip")).toBe(true);
  });
});

describe("assertSafeUrl", () => {
  it("rejects non-HTTPS URLs", async () => {
    await expect(assertSafeUrl("http://1.1.1.1/")).rejects.toThrow();
  });

  it.each([
    "https://127.0.0.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[::ffff:7f00:1]/", // hex IPv4-mapped loopback literal
  ])("rejects private/reserved literal host %s", async (url) => {
    await expect(assertSafeUrl(url)).rejects.toThrow();
  });

  it("allows a public IP literal (no DNS needed)", async () => {
    await expect(assertSafeUrl("https://1.1.1.1/")).resolves.toBeUndefined();
  });
});
