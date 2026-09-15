import { Navigate, Outlet } from "react-router-dom";
import { isAuthenticated } from "../services/authService";

export function PrivateRoute() {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
