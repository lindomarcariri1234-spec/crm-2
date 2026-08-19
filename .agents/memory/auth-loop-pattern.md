---
name: RoleRedirect auth loop
description: Why redirecting to /sign-in when me=null causes an infinite loop, and how the authError state breaks it.
---

# RoleRedirect auth loop

## Rule
When `me` is null after `syncMe` + `refetch()`, do NOT call `setLocation("/sign-in")`.
Use `setAuthError(true)` instead to show an error UI with "Tentar novamente" and "Sair" buttons.

**Why:** Clerk's `<SignIn>` component detects an active session and immediately
redirects to `afterSignInUrl` (default: "/"), remounting `RoleRedirect`, which
calls `syncMe` again, resulting in hundreds of requests per minute in an
infinite loop. Browser console shows:
> "The `<SignIn/>` component cannot render when a user is already signed in...
> Clerk is redirecting to the `afterSignIn` URL instead."

**How to apply:**
- In `RoleRedirect` (App.tsx): use `const [authError, setAuthError] = useState(false);`
- Set `setAuthError(true)` when `synced && !isLoading && !me`
- Render error screen with `signOut({ redirectUrl: ... })` when `authError`
- Reset `authError` in `handleRetry`

## Common causes of me=null after sync

1. **Missing DB column** in `tenantsTable` → `GET /api/users/me` returns 500
   (not 401). Schema drift between Drizzle schema and actual DB. Fix: run
   `pnpm --filter @workspace/db migrate`.

2. **Clerk proxy not configured** in production → `__session` cookie is set on
   `clerk.visitecrm.pro` instead of `visitecariri.com.br` → `getAuth` returns
   null userId → 401 on every request. Fix: re-publish so Replit injects
   `VITE_CLERK_PROXY_URL`.

3. **Key mismatch**: `CLERK_SECRET_KEY` from different Clerk instance than
   `VITE_CLERK_PUBLISHABLE_KEY` baked into production build.
