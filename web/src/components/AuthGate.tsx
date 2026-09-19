import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Flex, Text } from "@radix-ui/themes";
import { api, AUTH_REQUIRED_EVENT } from "../api";
import { LoginPage } from "../pages/LoginPage";

interface AuthContextValue {
  // false when the server has no WEB_PASSWORD set (dashboard is open).
  authRequired: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({ authRequired: false, logout: async () => {} });

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

type GateState = "loading" | "login" | "ready";

// Asks the server whether a login is needed before rendering the dashboard,
// and drops back to the login page if any later request comes back 401
// (an expired or revoked session).
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("loading");
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .authStatus()
      .then((status) => {
        setAuthRequired(status.authRequired);
        setState(status.authenticated ? "ready" : "login");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not reach the server."));
  }, []);

  useEffect(() => {
    const onAuthRequired = () => setState("login");
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setState("login");
  }, []);

  if (error) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: "100vh" }}>
        <Text color="red">{error}</Text>
      </Flex>
    );
  }
  if (state === "loading") return null;
  if (state === "login") return <LoginPage onLoggedIn={() => setState("ready")} />;

  return <AuthContext.Provider value={{ authRequired, logout }}>{children}</AuthContext.Provider>;
}
