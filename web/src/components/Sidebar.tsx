import { NavLink } from "react-router-dom";
import { Flex, Text } from "@radix-ui/themes";
import { APP_ROUTES } from "../routes";
import { Logo } from "./Logo";

export function Sidebar() {
  return (
    <Flex
      direction="column"
      style={{
        width: 232,
        flexShrink: 0,
        height: "100vh",
        position: "sticky",
        top: 0,
        borderRight: "1px solid var(--gray-a5)",
        background: "var(--gray-2)",
      }}
    >
      <Flex align="center" gap="2" px="4" style={{ height: 56, borderBottom: "1px solid var(--gray-a4)" }}>
        <Logo size={26} />
        <Text weight="bold" size="3">
          Plex Director
        </Text>
      </Flex>

      <Flex direction="column" gap="1" p="3" style={{ flex: 1, overflowY: "auto" }}>
        {APP_ROUTES.map((route) => (
          <NavLink key={route.path} to={route.path} end={route.end} className="nav-link">
            {({ isActive }) => (
              <Flex
                align="center"
                gap="3"
                px="3"
                py="2"
                style={{
                  borderRadius: "var(--radius-3)",
                  color: isActive ? "var(--accent-12)" : "var(--gray-11)",
                  background: isActive ? "var(--accent-a4)" : "transparent",
                  borderLeft: isActive ? "3px solid var(--accent-9)" : "3px solid transparent",
                  fontWeight: isActive ? 600 : 500,
                  transition: "background-color 120ms ease, color 120ms ease, border-color 120ms ease",
                }}
              >
                {route.icon}
                <Text size="2">{route.label}</Text>
              </Flex>
            )}
          </NavLink>
        ))}
      </Flex>
    </Flex>
  );
}
