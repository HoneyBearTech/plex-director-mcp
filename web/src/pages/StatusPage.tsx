import { Badge, Callout, Card, Flex, Heading, Table, Text } from "@radix-ui/themes";
import { api } from "../api";
import { usePolling } from "../usePolling";

export function StatusPage() {
  const activity = usePolling(api.plexActivity, 10_000);
  const analytics = usePolling(api.libraryAnalytics, 60_000);

  return (
    <Flex direction="column" gap="4">
      <Heading size="6">Server Status</Heading>

      <Card>
        <Heading size="4" mb="3">
          Plex Activity
        </Heading>
        {activity.error && (
          <Callout.Root color="red" mb="2">
            <Callout.Text>{activity.error}</Callout.Text>
          </Callout.Root>
        )}
        {activity.data && (
          <>
            <Text mb="3" as="p">
              {activity.data.streamCount} active stream{activity.data.streamCount === 1 ? "" : "s"}
              {activity.data.streamCount > 0 && (
                <Text color="gray">
                  {" "}
                  ({activity.data.directPlayCount} direct play, {activity.data.transcodeCount} transcoding)
                </Text>
              )}
            </Text>
            <Table.Root>
              <Table.Body>
                {activity.data.sessions.map((session, i) => (
                  <Table.Row key={i}>
                    <Table.Cell>{session.user}</Table.Cell>
                    <Table.Cell>
                      {session.title} {session.year && `(${session.year})`}
                    </Table.Cell>
                    <Table.Cell>{session.resolution}</Table.Cell>
                    <Table.Cell>
                      <Badge color={session.transcoding ? "amber" : "green"}>
                        {session.transcoding ? "Transcoding" : "Direct play"}
                      </Badge>
                    </Table.Cell>
                    <Table.Cell>{session.progress}%</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </>
        )}
      </Card>

      <Card>
        <Heading size="4" mb="3">
          Library Analytics
        </Heading>
        {analytics.error && (
          <Callout.Root color="red" mb="2">
            <Callout.Text>{analytics.error}</Callout.Text>
          </Callout.Root>
        )}
        {analytics.data?.categories.map((category) => (
          <Flex direction="column" key={category.title} mb="4">
            <Heading size="3" mb="2">
              {category.title}
            </Heading>
            <Table.Root>
              <Table.Body>
                {category.rows.map((row, i) => (
                  <Table.Row key={i}>
                    <Table.Cell>{row.label}</Table.Cell>
                    <Table.Cell>{row.plays} plays</Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Flex>
        ))}
      </Card>
    </Flex>
  );
}
