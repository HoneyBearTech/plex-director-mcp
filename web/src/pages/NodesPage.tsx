import { Badge, Callout, Card, Flex, Heading, Table, Text } from "@radix-ui/themes";
import { api } from "../api";
import { usePolling } from "../usePolling";

export function NodesPage() {
  const nodes = usePolling(api.nodeHealth, 15_000);

  return (
    <Flex direction="column" gap="4">
      <Heading size="6">Node Utilization</Heading>
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
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Host</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>CPU</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>RAM</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Containers</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {nodes.data.hosts.map((node) => (
                <Table.Row key={node.host}>
                  <Table.Cell>{node.host}</Table.Cell>
                  <Table.Cell>{node.online ? `${node.cpuPercent?.toFixed(1)}%` : "—"}</Table.Cell>
                  <Table.Cell>
                    {node.online ? `${node.ramPercent?.toFixed(1)}% (${node.ramUsedMb}MB/${node.ramTotalMb}MB)` : "—"}
                  </Table.Cell>
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
        )}
      </Card>
    </Flex>
  );
}
