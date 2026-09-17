import { useEffect, useState } from "react";
import { Badge, Box, Button, Callout, Card, Flex, Heading, Select, Tabs, Text, TextField } from "@radix-ui/themes";
import { api, type SecretField, type SettingsResponse, type SettingsService } from "../api";
import { useAppearance, type Appearance } from "../theme";

interface FieldConfig {
  name: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

const SERVICE_TABS: Array<{ value: SettingsService; label: string; fields: FieldConfig[] }> = [
  {
    value: "sonarr",
    label: "Sonarr",
    fields: [
      { name: "url", label: "URL", placeholder: "http://sonarr:8989" },
      { name: "apiKey", label: "API Key", secret: true },
    ],
  },
  {
    value: "radarr",
    label: "Radarr",
    fields: [
      { name: "url", label: "URL", placeholder: "http://radarr:7878" },
      { name: "apiKey", label: "API Key", secret: true },
    ],
  },
  {
    value: "prowlarr",
    label: "Prowlarr",
    fields: [
      { name: "url", label: "URL", placeholder: "http://prowlarr:9696" },
      { name: "apiKey", label: "API Key", secret: true },
    ],
  },
  {
    value: "sabnzbd",
    label: "SABnzbd",
    fields: [
      { name: "url", label: "URL", placeholder: "http://sabnzbd:8080" },
      { name: "apiKey", label: "API Key", secret: true },
    ],
  },
  {
    value: "qbittorrent",
    label: "qBittorrent",
    fields: [
      { name: "url", label: "URL", placeholder: "http://qbittorrent:8080" },
      { name: "username", label: "Username" },
      { name: "password", label: "Password", secret: true },
    ],
  },
  {
    value: "tautulli",
    label: "Tautulli",
    fields: [
      { name: "url", label: "URL", placeholder: "http://tautulli:8181" },
      { name: "apiKey", label: "API Key", secret: true },
    ],
  },
  {
    value: "tmdb",
    label: "TMDB",
    fields: [{ name: "apiKey", label: "API Key", secret: true }],
  },
  {
    value: "nodes",
    label: "Nodes",
    fields: [
      { name: "hosts", label: "Hosts (comma-separated)", placeholder: "192.168.1.10,192.168.1.11" },
      { name: "sshUser", label: "SSH Username" },
    ],
  },
];

function ServiceSettingsForm({
  service,
  fields,
  initial,
}: {
  service: SettingsService;
  fields: FieldConfig[];
  initial: Record<string, string | SecretField>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of fields) {
      v[f.name] = f.secret ? "" : ((initial[f.name] as string) ?? "");
    }
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateSettings(service, values);
      setSaved(true);
      // A saved secret goes back to a blank field - typing a new value is
      // what changes it, leaving it blank keeps whatever's already stored.
      setValues((prev) => {
        const next = { ...prev };
        for (const f of fields) {
          if (f.secret) next[f.name] = "";
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save}>
      <Flex direction="column" gap="3" maxWidth="480px">
        {fields.map((f) => {
          const current = initial[f.name];
          const configured = f.secret && typeof current === "object" && current.configured;
          return (
            <Box key={f.name}>
              <Flex justify="between" align="center" mb="1">
                <Text as="label" size="2" weight="medium">
                  {f.label}
                </Text>
                {f.secret && <Badge color={configured ? "green" : "gray"}>{configured ? "configured" : "not set"}</Badge>}
              </Flex>
              <TextField.Root
                type={f.secret ? "password" : "text"}
                placeholder={f.secret ? "Leave blank to keep the current value" : f.placeholder}
                value={values[f.name]}
                onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
              />
            </Box>
          );
        })}
        <Flex gap="3" align="center">
          <Button type="submit" loading={saving}>
            Save
          </Button>
          {saved && (
            <Text color="green" size="2">
              Saved
            </Text>
          )}
          {error && (
            <Text color="red" size="2">
              {error}
            </Text>
          )}
        </Flex>
      </Flex>
    </form>
  );
}

function UISettingsForm() {
  const { appearance, setAppearance } = useAppearance();

  return (
    <Flex direction="column" gap="3" maxWidth="320px">
      <Box>
        <Text as="label" size="2" weight="medium" mb="1" style={{ display: "block" }}>
          Appearance
        </Text>
        <Select.Root value={appearance} onValueChange={(value) => setAppearance(value as Appearance)}>
          <Select.Trigger />
          <Select.Content>
            <Select.Item value="inherit">System</Select.Item>
            <Select.Item value="light">Light</Select.Item>
            <Select.Item value="dark">Dark</Select.Item>
          </Select.Content>
        </Select.Root>
      </Box>
    </Flex>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load settings"));
  }, []);

  return (
    <Flex direction="column" gap="4">
      <Heading size="6">Settings</Heading>
      <Callout.Root color="amber">
        <Callout.Text>
          This page has no authentication - anyone who can reach this server can view and change these settings.
          API keys and passwords are never sent back to the browser once saved; only whether they're set.
        </Callout.Text>
      </Callout.Root>

      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      {!settings && !error && <Text color="gray">Loading…</Text>}

      {settings && (
        <Card>
          <Tabs.Root defaultValue="sonarr">
            <Tabs.List>
              {SERVICE_TABS.map((tab) => (
                <Tabs.Trigger key={tab.value} value={tab.value}>
                  {tab.label}
                </Tabs.Trigger>
              ))}
              <Tabs.Trigger value="ui">UI</Tabs.Trigger>
            </Tabs.List>
            {SERVICE_TABS.map((tab) => (
              <Tabs.Content key={tab.value} value={tab.value}>
                <Box pt="4">
                  <ServiceSettingsForm
                    service={tab.value}
                    fields={tab.fields}
                    initial={settings[tab.value] as Record<string, string | SecretField>}
                  />
                </Box>
              </Tabs.Content>
            ))}
            <Tabs.Content value="ui">
              <Box pt="4">
                <UISettingsForm />
              </Box>
            </Tabs.Content>
          </Tabs.Root>
        </Card>
      )}
    </Flex>
  );
}
