import type { ReactNode } from "react";
import { ActivityLogIcon, ChatBubbleIcon, DesktopIcon, DownloadIcon, GearIcon } from "@radix-ui/react-icons";
import { QueryPage } from "./pages/QueryPage";
import { StatusPage } from "./pages/StatusPage";
import { NodesPage } from "./pages/NodesPage";
import { QueuesPage } from "./pages/QueuesPage";
import { SettingsPage } from "./pages/SettingsPage";

export interface AppRoute {
  path: string;
  label: string;
  icon: ReactNode;
  element: ReactNode;
  end?: boolean;
}

// Single source of truth for the sidebar nav and the router, so the two
// can never drift out of sync with each other.
export const APP_ROUTES: AppRoute[] = [
  { path: "/", label: "Query", icon: <ChatBubbleIcon width={18} height={18} />, element: <QueryPage />, end: true },
  { path: "/status", label: "Server Status", icon: <ActivityLogIcon width={18} height={18} />, element: <StatusPage /> },
  { path: "/nodes", label: "Node Utilization", icon: <DesktopIcon width={18} height={18} />, element: <NodesPage /> },
  { path: "/queues", label: "Queues", icon: <DownloadIcon width={18} height={18} />, element: <QueuesPage /> },
  { path: "/settings", label: "Settings", icon: <GearIcon width={18} height={18} />, element: <SettingsPage /> },
];
