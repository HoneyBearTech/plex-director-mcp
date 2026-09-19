import { Badge, Callout, Card, Flex, Heading, Table, Text } from "@radix-ui/themes";
import { api, type IndexerState } from "../api";
import { usePolling } from "../usePolling";

const STATE_BADGE: Record<IndexerState, { color: "green" | "amber" | "red" | "gray"; label: string }> = {
  healthy: { color: "green", label: "Healthy" },
  warning: { color: "amber", label: "Recent failures" },
  "backing-off": { color: "red", label: "Backing off" },
  disabled: { color: "gray", label: "Disabled" },
};

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "-";
}

export function IndexersPage() {
  const health = usePolling(api.indexerHealth, 30_000);

  return (
    <Flex direction="column" gap="4">
      {health.error && (
        <Callout.Root color="red">
          <Callout.Text>{health.error}</Callout.Text>
        </Callout.Root>
      )}

      {health.data && health.data.warnings.length > 0 && (
        <Callout.Root color="amber">
          <Callout.Text>
            <Text weight="bold">Prowlarr reports:</Text>
            {health.data.warnings.map((warning, i) => (
              <Text as="div" size="2" key={i}>
                {warning.message}
              </Text>
            ))}
          </Callout.Text>
        </Callout.Root>
      )}

      <Card>
        <Heading size="4" mb="3">
          Indexers
        </Heading>
        {health.loading && !health.data && <Text color="gray">Loading…</Text>}
        {health.data && health.data.indexers.length === 0 && <Text color="gray">No indexers configured in Prowlarr.</Text>}
        {health.data && health.data.indexers.length > 0 && (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Indexer</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Type</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Priority</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Last failure</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Retry after</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {health.data.indexers.map((indexer) => {
                const badge = STATE_BADGE[indexer.state];
                return (
                  <Table.Row key={indexer.id}>
                    <Table.RowHeaderCell>{indexer.name}</Table.RowHeaderCell>
                    <Table.Cell>
                      <Badge variant="soft" color="gray">
                        {indexer.protocol}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>{indexer.priority}</Table.Cell>
                    <Table.Cell>
                      <Badge color={badge.color}>{badge.label}</Badge>
                    </Table.Cell>
                    <Table.Cell>{formatTime(indexer.mostRecentFailure)}</Table.Cell>
                    <Table.Cell>{formatTime(indexer.disabledTill)}</Table.Cell>
                  </Table.Row>
                );
              })}
            </Table.Body>
          </Table.Root>
        )}
      </Card>
    </Flex>
  );
}
