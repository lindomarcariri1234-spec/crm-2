import { createElement, type ReactNode } from "react";

type AuthWidgetProps = Record<string, unknown>;

function AuthWidget({ mode }: { mode: "sign-in" | "sign-up" }) {
  const signIn = mode === "sign-in";
  return createElement(
    "form",
    { "data-testid": `visual-clerk-${mode}`, className: "space-y-4" },
    createElement(
      "label",
      { className: "block space-y-1 text-sm font-medium" },
      signIn ? "E-mail" : "Nome",
      createElement("input", {
        type: signIn ? "email" : "text",
        autoComplete: signIn ? "email" : "name",
        className: "w-full h-10 rounded-md border bg-background px-3",
        "aria-label": signIn ? "E-mail" : "Nome",
      }),
    ),
    signIn
      ? createElement(
          "label",
          { className: "block space-y-1 text-sm font-medium" },
          "Senha",
          createElement("input", {
            type: "password",
            autoComplete: "current-password",
            className: "w-full h-10 rounded-md border bg-background px-3",
            "aria-label": "Senha",
          }),
        )
      : null,
    createElement(
      "button",
      {
        type: "button",
        className: "w-full rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground",
      },
      signIn ? "Entrar" : "Criar conta",
    ),
  );
}

export function SignIn(props: AuthWidgetProps) {
  return createElement(AuthWidget, { ...props, mode: "sign-in" });
}

export function SignUp(props: AuthWidgetProps) {
  return createElement(AuthWidget, { ...props, mode: "sign-up" });
}

export function useUser() {
  return { isLoaded: true, isSignedIn: false, user: null };
}

export function ClerkProvider({ children }: { children: ReactNode }) {
  return children;
}

export function Show({
  when,
  children,
  fallback = null,
}: {
  when: boolean;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return when ? children : fallback;
}

export function useAuth() {
  return { isLoaded: true, isSignedIn: false, userId: null, orgId: null };
}

export function useClerk() {
  return { signOut: async () => undefined };
}

export function useSignIn() {
  return {
    isLoaded: true,
    signIn: { create: async () => ({}), prepareFirstFactor: async () => ({}) },
    setActive: async () => undefined,
  };
}

export function useSignUp() {
  return {
    isLoaded: true,
    signUp: { create: async () => ({}), prepareEmailAddressVerification: async () => ({}) },
    setActive: async () => undefined,
  };
}

export function SignInButton({ children }: { children: ReactNode }) {
  return createElement("div", { "data-testid": "visual-sign-in-button" }, children);
}

export function SignUpButton({ children }: { children: ReactNode }) {
  return createElement("div", { "data-testid": "visual-sign-up-button" }, children);
}