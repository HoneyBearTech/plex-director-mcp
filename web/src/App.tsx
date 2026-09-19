import { Route, Routes, useLocation } from "react-router-dom";
import { Box, Callout, Flex, Heading } from "@radix-ui/themes";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { Sidebar } from "./components/Sidebar";
import { useAuth } from "./components/AuthGate";
import { APP_ROUTES } from "./routes";

export function App() {
  const location = useLocation();
  const { authRequired } = useAuth();
  const current = APP_ROUTES.find((route) =>
    route.end ? route.path === location.pathname : location.pathname.startsWith(route.path)
  );

  return (
    <Flex style={{ minHeight: "100vh" }}>
      <Sidebar />
      <Box style={{ flex: 1, minWidth: 0 }}>
        <Flex align="center" px="6" style={{ height: 56, borderBottom: "1px solid var(--gray-a5)" }}>
          <Heading size="4">{current?.label ?? "Plex Director"}</Heading>
        </Flex>
        <Box px="6" py="5" style={{ maxWidth: 1200 }}>
          {!authRequired && (
            <Callout.Root color="amber" mb="4">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>
                This dashboard has no password, so anyone who can reach it can view and change settings. Set{" "}
                <strong>WEB_PASSWORD</strong> in the server&apos;s environment and restart to require a login.
              </Callout.Text>
            </Callout.Root>
          )}
          <Routes>
            {APP_ROUTES.map((route) => (
              <Route key={route.path} path={route.path} element={route.element} />
            ))}
          </Routes>
        </Box>
      </Box>
    </Flex>
  );
}
