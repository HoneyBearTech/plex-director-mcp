import { Badge, Callout, Card, Flex, Heading, Progress, Table, Text } from "@radix-ui/themes";
import { api } from "../api";
import { usePolling } from "../usePolling";

const STATUS_COLOR: Record<string, "gray" | "blue" | "amber" | "green" | "red"> = {
  PENDING: "gray",
  RUNNING: "blue",
  PAUSED: "amber",
  COMPLETED: "green",
  CANCELLED: "red",
};

function formatTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "-";
}

export function JobsPage() {
  const jobs = usePolling(api.backgroundJobs, 10_000);

  return (
    <Flex direction="column" gap="4">
      {jobs.error && (
        <Callout.Root color="red">
          <Callout.Text>{jobs.error}</Callout.Text>
        </Callout.Root>
      )}

      <Card>
        <Heading size="4" mb="1">
          Background jobs
        </Heading>
        <Text as="p" size="2" color="gray" mb="3">
          Batch jobs such as media upgrades. This page is read-only - start, pause, resume, or cancel a job by asking the assistant.
        </Text>

        {jobs.loading && !jobs.data && <Text color="gray">Loading…</Text>}
        {jobs.data && jobs.data.jobs.length === 0 && (
          <Text color="gray">No background jobs yet. Ask the assistant to plan a media upgrade to create one.</Text>
        )}
        {jobs.data && jobs.data.jobs.length > 0 && (
          <Table.Root>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeaderCell>Job</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Task</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Progress</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Created</Table.ColumnHeaderCell>
                <Table.ColumnHeaderCell>Last update</Table.ColumnHeaderCell>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {jobs.data.jobs.map((job) => {
                const percent = job.totalItems > 0 ? Math.round((job.processedItems / job.totalItems) * 100) : 0;
                return (
                  <Table.Row key={job.id}>
                    <Table.RowHeaderCell>#{job.id}</Table.RowHeaderCell>
                    <Table.Cell>{job.taskName}</Table.Cell>
                    <Table.Cell>
                      <Badge color={STATUS_COLOR[job.status] ?? "gray"}>{job.status}</Badge>
                    </Table.Cell>
                    <Table.Cell>
                      <Flex align="center" gap="2">
                        <Progress value={percent} style={{ width: 100 }} />
                        <Text size="1" color="gray">
                          {job.processedItems}/{job.totalItems}
                        </Text>
                      </Flex>
                    </Table.Cell>
                    <Table.Cell>{formatTime(job.createdAt)}</Table.Cell>
                    <Table.Cell>{formatTime(job.updatedAt)}</Table.Cell>
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
