import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clerk/react", async () => {
  const { createElement: h } = await import("react");

  return {
    SignIn: (props: { signUpUrl: string; fallbackRedirectUrl: string }) =>
      h("div", {
        "data-clerk-widget": "sign-in",
        "data-switch-url": props.signUpUrl,
        "data-fallback-url": props.fallbackRedirectUrl,
      }),
    SignUp: (props: { signInUrl: string; fallbackRedirectUrl: string }) =>
      h("div", {
        "data-clerk-widget": "sign-up",
        "data-switch-url": props.signInUrl,
        "data-fallback-url": props.fallbackRedirectUrl,
      }),
  };
});

import SignInPage from "./sign-in";
import SignUpPage from "./sign-up";

describe("agency auth navigation", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("keeps a safe requested destination when an existing signup email switches to sign-in", () => {
    window.history.replaceState(
      {},
      "",
      "/sign-up?redirect_url=%2Fperfil%3Ftab%3Dreservas",
    );

    const markup = renderToStaticMarkup(createElement(SignUpPage));

    expect(markup).toContain('data-testid="auth-mode-link-sign-in"');
    expect(markup).toContain('href="/sign-in?redirect_url=%2Fperfil%3Ftab%3Dreservas"');
    expect(markup).toContain('data-switch-url="/sign-in?redirect_url=%2Fperfil%3Ftab%3Dreservas"');
    expect(markup).toContain('data-fallback-url="/perfil?tab=reservas"');
  });

  it("keeps the same safe destination when switching from sign-in to agency signup", () => {
    window.history.replaceState({}, "", "/sign-in?redirect_url=%2Freservas");

    const markup = renderToStaticMarkup(createElement(SignInPage));

    expect(markup).toContain('data-testid="auth-mode-link-sign-up"');
    expect(markup).toContain('href="/sign-up?redirect_url=%2Freservas"');
    expect(markup).toContain('data-switch-url="/sign-up?redirect_url=%2Freservas"');
    expect(markup).toContain('data-fallback-url="/reservas"');
  });

  it("rejects an external requested destination before rendering either auth path", () => {
    window.history.replaceState(
      {},
      "",
      "/sign-up?redirect_url=https%3A%2F%2Fevil.example",
    );

    const markup = renderToStaticMarkup(createElement(SignUpPage));

    expect(markup).toContain('href="/sign-in?redirect_url=%2F"');
    expect(markup).toContain('data-switch-url="/sign-in?redirect_url=%2F"');
    expect(markup).toContain('data-fallback-url="/"');
  });
});
