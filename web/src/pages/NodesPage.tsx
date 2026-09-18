import { Badge, Box, Callout, Card, Flex, Progress, Table, Text } from "@radix-ui/themes";
import { api } from "../api";
import { usePolling } from "../usePolling";

function loadColor(percent: number): "red" | "amber" | "blue" {
  if (percent >= 90) return "red";
  if (percent >= 70) return "amber";
  return "blue";
}

export function NodesPage() {
  const nodes = usePolling(api.nodeHealth, 15_000);

  return (
    <Flex direction="column" gap="4">
      <Card>
        {nodes.error && (
          <Callout.Root color="red">
            <Callout.Text>{nodes.error}</Callout.Text>
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
