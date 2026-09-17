import { Badge, Callout, Card, Flex, Heading, Table, Text } from "@radix-ui/themes";
import { api } from "../api";
import { usePolling } from "../usePolling";

export function QueuesPage() {
  const sabnzbd = usePolling(api.sabnzbdQueue, 10_000);
  const qbittorrent = usePolling(api.qbittorrentQueue, 10_000);

  return (
    <Flex direction="column" gap="4">
      <Heading size="6">Downloader Queues</Heading>

      <Card>
        <Heading size="4" mb="3">
          SABnzbd
        </Heading>
        {sabnzbd.error && (
          <Callout.Root color="red" mb="2">
            <Callout.Text>{sabnzbd.error}</Callout.Text>
          </Callout.Root>
        )}
        {sabnzbd.data && sabnzbd.data.items.length === 0 && <Text color="gray">Queue is empty.</Text>}
        {sabnzbd.data && sabnzbd.data.items.length > 0 && (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>File</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Progress</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>ETA</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {sabnzbd.data.items.map((item, i) => (
                <Table.Row key={i}>
                  <Table.Cell>{item.filename}</Table.Cell>
                  <Table.Cell>{item.status}</Table.Cell>
                  <Table.Cell>{item.percentage}%</Table.Cell>
                  <Table.Cell>{item.timeleft}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card>

      <Card>
        <Heading size="4" mb="3">
          qBittorrent
        </Heading>
        {qbittorrent.error && (
          <Callout.Root color="red" mb="2">
            <Callout.Text>{qbittorrent.error}</Callout.Text>
          </Callout.Root>
        )}
        {qbittorrent.data && qbittorrent.data.items.length === 0 && <Text color="gray">Queue is empty.</Text>}
        {qbittorrent.data && qbittorrent.data.items.length > 0 && (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Name</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>State</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Progress</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Speed</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Seeders</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {qbittorrent.data.items.map((item, i) => (
                <Table.Row key={i}>
                  <Table.Cell>
                    <Flex gap="2" align="center">
                      <Text>{item.name}</Text>
                      {item.stalled && <Badge color="red">stalled</Badge>}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell>{item.state}</Table.Cell>
                  <Table.Cell>{(item.progress * 100).toFixed(1)}%</Table.Cell>
                  <Table.Cell>{item.dlspeedKbps.toFixed(1)} KB/s</Table.Cell>
                  <Table.Cell>{item.seeders}</Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        )}
      </Card>
    </Flex>
  );
}
