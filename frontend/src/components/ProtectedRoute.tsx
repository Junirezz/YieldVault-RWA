import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { roleAllows, type UserRole } from "../lib/roles";

interface ProtectedRouteProps {
  role: UserRole;
  allow: readonly UserRole[];
  redirectTo?: string;
  children: React.ReactNode;
}

/**
 * Route guard that redirects away when the current role isn't in `allow`.
 * The attempted path is passed along in location state so the redirect
 * target can restore it later (e.g. after connecting a wallet).
 */
export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  role,
  allow,
  redirectTo = "/",
  children,
}) => {
  const location = useLocation();

  if (!roleAllows(role, allow)) {
    return <Navigate to={redirectTo} replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
