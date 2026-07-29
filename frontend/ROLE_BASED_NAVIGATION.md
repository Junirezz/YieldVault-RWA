# Role-Based Navigation & Route Guards

The app resolves a lightweight client-side `UserRole` from the connected
wallet address and uses it to (a) show or hide navigation links and (b)
gate routes that shouldn't be reachable by everyone.

> [!IMPORTANT]
> This is a UI convenience layer, **not** a security boundary. The admin
> wallet allowlist ships in the client bundle, so any privileged action it
> gates must still be authorized server-side (see
> `backend/src/middleware/rbac.ts` for the real RBAC enforcement on admin
> API endpoints).

## Roles

| Role | Resolved when | Notes |
| :--- | :--- | :--- |
| `guest` | No wallet connected | Default state before `WalletConnect` succeeds. |
| `investor` | Wallet connected, not on the admin list | Normal vault user. |
| `admin` | Wallet connected and address is in `VITE_ADMIN_WALLETS` | Sees the Admin nav link and can reach `/admin`. |

Role resolution lives in `src/lib/roles.ts`:

```ts
import { resolveUserRole } from "./lib/roles";

const role = resolveUserRole(walletAddress); // "guest" | "investor" | "admin"
```

`VITE_ADMIN_WALLETS` is a comma-separated list of Stellar wallet addresses
(case-insensitive, whitespace-trimmed). Leave it blank to disable the admin
role for everyone. See `.env.example` and `docs/ENV_VARIABLE_MATRIX.md`.

## Nav Visibility

`App.tsx` computes `role` from the connected wallet and passes it to
`<Navbar role={role} />`. `Navbar` only renders the Admin link (desktop,
mobile, and dropdown menus) when `role === "admin"`; every other existing
link is unaffected.

## Route Guards

`<ProtectedRoute>` (`src/components/ProtectedRoute.tsx`) wraps a route
element and redirects (via `<Navigate replace>`) when the current role
isn't in the `allow` list:

```tsx
<Route
  path="/admin"
  element={
    <ProtectedRoute role={role} allow={["admin"]}>
      <Admin walletAddress={walletAddress} />
    </ProtectedRoute>
  }
/>
```

- `redirectTo` defaults to `/` and can be overridden per route.
- The attempted path is passed through `location.state.from` so a future
  redirect target (e.g. after connecting a wallet) can restore it.

## Adding a New Gated Route

1. Add the role(s) allowed to `allow` when declaring the `<Route>` in `App.tsx`.
2. If the route should also be hidden from nav for disallowed roles, gate the
   `NavLink` in `Navbar.tsx` on `role` the same way the Admin link is gated.
3. Add/extend tests in `src/lib/roles.test.ts` and
   `src/components/ProtectedRoute.test.tsx` for new role combinations.
