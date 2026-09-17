import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Box, Container, Heading, Tabs } from "@radix-ui/themes";
import { QueryPage } from "./pages/QueryPage";
import { StatusPage } from "./pages/StatusPage";
import { NodesPage } from "./pages/NodesPage";
import { QueuesPage } from "./pages/QueuesPage";
import { SettingsPage } from "./pages/SettingsPage";

const TABS = [
  { value: "/", label: "Query" },
  { value: "/status", label: "Server Status" },
  { value: "/nodes", label: "Node Utilization" },
  { value: "/queues", label: "Queues" },
  { value: "/settings", label: "Settings" },
];

export function App() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <Box>
      <Box style={{ borderBottom: "1px solid var(--gray-a5)" }} px="5" pt="4">
        <Container size="3">
          <Heading size="5" mb="3">
            Plex Director
          </Heading>
          <Tabs.Root value={location.pathname} onValueChange={(value) => navigate(value)}>
            <Tabs.List>
              {TABS.map((tab) => (
                <Tabs.Trigger key={tab.value} value={tab.value}>
                  {tab.label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
          </Tabs.Root>
        </Container>
      </Box>
      <Container size="3" px="5" py="5">
        <Routes>
          <Route path="/" element={<QueryPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/nodes" element={<NodesPage />} />
          <Route path="/queues" element={<QueuesPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Container>
    </Box>
  );
}
