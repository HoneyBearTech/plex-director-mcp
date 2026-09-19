import { useState } from "react";
import { Button, Callout, Card, Flex, Heading, Text, TextField } from "@radix-ui/themes";
import { api } from "../api";
import { Logo } from "../components/Logo";

export function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || loading) return;

    setLoading(true);
    setError(null);
    try {
      await api.login(password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setLoading(false);
    }
  }

  return (
    <Flex align="center" justify="center" style={{ minHeight: "100vh" }} px="4">
      <Card size="3" style={{ width: "100%", maxWidth: 360 }}>
        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="4">
            <Flex align="center" gap="2">
              <Logo size={28} />
              <Heading size="5">Plex Director</Heading>
            </Flex>
            <Text size="2" color="gray">
              Enter the dashboard password to continue.
            </Text>
            <TextField.Root
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <Callout.Root color="red" size="1">
                <Callout.Text>{error}</Callout.Text>
              </Callout.Root>
            )}
            <Button type="submit" loading={loading} disabled={!password}>
              Sign in
            </Button>
          </Flex>
        </form>
      </Card>
    </Flex>
  );
}
