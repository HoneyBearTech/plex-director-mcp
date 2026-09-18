import { Route, Routes, useLocation } from "react-router-dom";
import { Box, Flex, Heading } from "@radix-ui/themes";
import { Sidebar } from "./components/Sidebar";
import { APP_ROUTES } from "./routes";

export function App() {
  const location = useLocation();
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
