import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

interface GuardedRouteState {
  from?: string;
}

/**
 * Completes the redirect-back half of ProtectedRoute's guard: when a
 * disallowed role hits a guarded route, ProtectedRoute redirects away and
 * stashes the attempted path in `location.state.from` so it can be restored
 * later (e.g. once the user connects the wallet that grants access) — but
 * nothing consumed that state, so the user was never actually sent back.
 *
 * Call this once per role change. It attempts the stored `from` path exactly
 * once per role value (mount counts as the first "value"): if the new role
 * still isn't allowed, ProtectedRoute immediately guards it again, which
 * doesn't change `role`, so this hook won't fire again and there's no
 * redirect loop. If role changes again later (e.g. the user connects the
 * wallet that grants access), it gets a fresh attempt at the same `from`.
 */
export function useRestoreGuardedRoute(role: unknown): void {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const from = (location.state as GuardedRouteState | null)?.from;
    if (!from || from === location.pathname) return;

    navigate(from, { replace: true });
    // Intentionally scoped to `role` only: this should fire exactly once per
    // role transition (mount included), not on every location/navigate
    // identity change, so a guard-bounce for an unchanged role can't loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);
}
