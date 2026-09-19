import { useState } from "react";
import { Badge, Box, Button, Callout, Card, Flex, Progress, Table, Text } from "@radix-ui/themes";
import { api } from "../api";
import { usePolling } from "../usePolling";

function loadColor(percent: number): "red" | "amber" | "blue" {
  if (percent >= 90) return "red";
  if (percent >= 70) return "amber";
  return "blue";
}

export function NodesPage() {
  const nodes = usePolling(api.nodeHealth, 15_000);
  const [trusting, setTrusting] = useState<string | null>(null);
  const [trustError, setTrustError] = useState<string | null>(null);

  // A host's SSH key changed. Only the person who knows whether it was rebuilt
  // can say, so this asks first, then forgets the old key so the next check
  // remembers whatever the host presents now.
  async function trustNewKey(host: string) {
    if (!window.confirm(`Trust the new SSH key for ${host}?\n\nOnly do this if you rebuilt or reinstalled it. An unexpected key change can mean someone is impersonating the host.`)) return;
    setTrusting(host);
    setTrustError(null);
    try {
      await api.trustNewKey(host);
      nodes.refresh();
    } catch (err) {
      setTrustError(err instanceof Error ? err.message : "Could not update the host key.");
    } finally {
      setTrusting(null);
    }
  }

  return (
    <Flex direction="column" gap="4">
      <Card>
        {nodes.error && (
          <Callout.Root color="red">
            <Callout.Text>{nodes.error}</Callout.Text>
          </Callout.Root>
        )}
        {trustError && (
          <Callout.Root color="red" mb="3">
            <Callout.Text>{trustError}</Callout.Text>
          </Callout.Root>
        )}
        {nodes.data && nodes.data.hosts.length === 0 && (
          <Text color="gray">No hosts configured. Set this up on the Settings page.</Text>
        )}
        {nodes.data && nodes.data.hosts.length > 0 && (
          <Box style={{ overflowX: "auto" }}>
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Host</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>CPU</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>RAM</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Disk</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Uptime</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Containers</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {nodes.data.hosts.map((node) => (
                <Table.Row key={node.host}>
                  <Table.Cell>
                    <Text weight="medium">{node.hostname}</Text>
                  </Table.Cell>
                  <Table.Cell>
                    {node.online ? (
                      <Flex align="center" gap="2">
                        <Progress value={node.cpuPercent} color={loadColor(node.cpuPercent ?? 0)} style={{ width: 90 }} />
                        <Text size="1" color="gray">
                          {node.cpuPercent?.toFixed(1)}%
                        </Text>
                      </Flex>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {node.online ? (
                      <Flex align="center" gap="2">
                        <Progress value={node.ramPercent} color={loadColor(node.ramPercent ?? 0)} style={{ width: 90 }} />
                        <Text size="1" color="gray">
                          {node.ramPercent?.toFixed(1)}% ({node.ramUsedMb}MB/{node.ramTotalMb}MB)
                        </Text>
                      </Flex>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {node.online ? (
                      <Flex align="center" gap="2">
                        <Progress value={node.diskPercent} color={loadColor(node.diskPercent ?? 0)} style={{ width: 90 }} />
                        <Text size="1" color="gray">
                          {node.diskPercent?.toFixed(0)}% ({node.diskUsed}/{node.diskTotal})
                        </Text>
                      </Flex>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                  <Table.Cell>{node.online ? <Text size="2">{node.uptime}</Text> : "—"}</Table.Cell>
                  <Table.Cell>
                    {node.online ? (
                      <Flex gap="2" align="center">
                        <Text>{node.containersRunning} running</Text>
                        {node.deadContainers && node.deadContainers.length > 0 && (
                          <Badge color="red">{node.deadContainers.length} stopped</Badge>
                        )}
                      </Flex>
                    ) : (
                      "—"
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge color={node.online ? "green" : "red"}>{node.online ? "Online" : "Offline"}</Badge>
                    {!node.online && node.hostKeyChanged && (
                      <Flex direction="column" gap="1" mt="2" align="start">
                        <Text size="1" color="red">
                          SSH host key changed
                        </Text>
                        <Text size="1" color="gray" style={{ maxWidth: 220, overflowWrap: "anywhere" }}>
                          Now presents {node.hostKeyChanged.actual}
                        </Text>
                        <Button size="1" variant="soft" color="red" loading={trusting === node.host} onClick={() => void trustNewKey(node.host)}>
                          Trust new key
                        </Button>
                      </Flex>
                    )}
                    {!node.online && !node.hostKeyChanged && node.error && (
                      <Text as="div" size="1" color="gray" mt="1" style={{ maxWidth: 220, overflowWrap: "anywhere" }}>
                        {node.error}
                      </Text>
                    )}
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
          </Box>
        )}
      </Card>
    </Flex>
  );
}
