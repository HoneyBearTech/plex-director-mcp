import { useState } from "react";
import { Badge, Box, Button, Callout, Card, Flex, Progress, Table, Text, TextField } from "@radix-ui/themes";
import { api, type ChatImage, type MediaRow } from "../api";
import { ChatText } from "../components/ChatText";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
  media?: MediaRow[];
}

function PosterThumb({ src, title }: { src: string | null; title: string }) {
  if (!src) {
    return <Flex width="40px" height="60px" flexShrink="0" style={{ borderRadius: 4, background: "var(--gray-a4)" }} />;
  }
  return (
    <img
      src={src}
      alt={`${title} poster`}
      width={40}
      height={60}
      loading="lazy"
      style={{ borderRadius: 4, objectFit: "cover", display: "block" }}
    />
  );
}

// Search results as a table with the poster next to each title. "In Plex"
// only appears when a tool actually checked ownership (libraries !== null).
// Shows add a Seasons / episodes column with watch progress, and a Kind column
// appears when movies and shows are mixed. A long result starts as a preview;
// the rest is one click away.
const PREVIEW_ROWS = 50;

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

function ShowProgress({ show }: { show: NonNullable<MediaRow["show"]> }) {
  const { seasons, episodes, ownedEpisodes } = show;
  // Sonarr rows report how much is downloaded; Plex rows report how much is watched.
  const downloads = ownedEpisodes !== undefined && ownedEpisodes !== null;
  const watchedEpisodes = downloads ? ownedEpisodes : show.watchedEpisodes;
  const incomplete = downloads && episodes !== null && watchedEpisodes !== null && watchedEpisodes < episodes;
  // A bar must not read "full" while episodes are missing, so 99.7% shows as 99%.
  const percent = episodes && watchedEpisodes !== null ? Math.min(incomplete ? 99 : 100, Math.round((watchedEpisodes / episodes) * 100)) : null;
  return (
    <Flex direction="column" align="start" gap="1">
      <Text size="1">
        {[seasons !== null ? plural(seasons, "season") : null, episodes !== null ? plural(episodes, "episode") : null]
          .filter(Boolean)
          .join(", ") || "-"}
      </Text>
      {percent !== null && watchedEpisodes !== null && (
        <>
          <Progress
            value={percent}
            size="1"
            color={incomplete ? "amber" : undefined}
            style={{ width: 90 }}
            aria-label={`${watchedEpisodes} of ${episodes} episodes ${downloads ? "downloaded" : "watched"}`}
          />
          <Text size="1" color="gray">
            {watchedEpisodes} of {episodes} {downloads ? "downloaded" : "watched"}
          </Text>
        </>
      )}
    </Flex>
  );
}

function MediaTable({ media }: { media: MediaRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = media.length > PREVIEW_ROWS;
  const visible = collapsible && !expanded ? media.slice(0, PREVIEW_ROWS) : media;
  const showOwnership = media.some((m) => m.libraries !== null);
  const showRating = media.some((m) => m.rating !== null);
  const showDetail = media.some((m) => m.genres.length > 0 || m.detail);
  const hasShows = media.some((m) => m.kind === "show");
  const hasMovies = media.some((m) => m.kind === "movie");
  // Only Plex search rows carry season/episode data (TMDb filmography rows do not).
  const hasShowDetail = media.some((m) => m.show);
  const noun = hasShows && hasMovies ? "title" : hasShows ? "show" : "movie";

  return (
    <>
    <Text as="p" size="1" color="gray" mt="2">
      {visible.length < media.length
        ? `Showing ${visible.length} of ${media.length} ${noun}s`
        : plural(media.length, noun)}
    </Text>
    <Table.Root size="1" variant="surface" style={{ marginTop: 4 }}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell width="56px" />
          <Table.ColumnHeaderCell>Title</Table.ColumnHeaderCell>
          {hasShows && hasMovies && <Table.ColumnHeaderCell>Kind</Table.ColumnHeaderCell>}
          <Table.ColumnHeaderCell>Year</Table.ColumnHeaderCell>
          {showOwnership && <Table.ColumnHeaderCell>In Plex</Table.ColumnHeaderCell>}
          {hasShowDetail && <Table.ColumnHeaderCell>Seasons / episodes</Table.ColumnHeaderCell>}
          {showDetail && <Table.ColumnHeaderCell>Details</Table.ColumnHeaderCell>}
          {showRating && <Table.ColumnHeaderCell>Rating</Table.ColumnHeaderCell>}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {visible.map((item, i) => (
          <Table.Row key={i} align="center">
            <Table.Cell>
              <PosterThumb src={item.posterUrl} title={item.title} />
            </Table.Cell>
            <Table.RowHeaderCell>
              {item.title}
              {item.show?.network && (
                <Text as="div" size="1" color="gray" weight="regular">
                  {item.show.network}
                </Text>
              )}
            </Table.RowHeaderCell>
            {hasShows && hasMovies && (
              <Table.Cell>
                <Badge color={item.kind === "show" ? "violet" : "blue"}>{item.kind === "show" ? "Show" : "Movie"}</Badge>
              </Table.Cell>
            )}
            <Table.Cell>{item.year ?? "-"}</Table.Cell>
            {showOwnership && (
              <Table.Cell>
                {item.libraries === null ? (
                  "-"
                ) : item.libraries.length === 0 ? (
                  <Badge color="gray">Not in Plex</Badge>
                ) : (
                  <Flex direction="column" align="start" gap="1">
                    {item.libraries.map((library) => (
                      <Badge key={library} color="green">
                        {library}
                      </Badge>
                    ))}
                  </Flex>
                )}
              </Table.Cell>
            )}
            {hasShowDetail && <Table.Cell>{item.show ? <ShowProgress show={item.show} /> : "-"}</Table.Cell>}
            {showDetail && <Table.Cell>{item.detail ?? item.genres.join(", ")}</Table.Cell>}
            {showRating && <Table.Cell>{item.rating !== null ? item.rating.toFixed(1) : "-"}</Table.Cell>}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
    {collapsible && (
      <Button variant="soft" color="gray" size="1" mt="2" onClick={() => setExpanded((open) => !open)}>
        {expanded ? `Show first ${PREVIEW_ROWS}` : `Show all ${media.length} ${noun}s`}
      </Button>
    )}
    </>
  );
}

export function QueryPage() {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || loading) return;

    setMessages((prev) => [...prev, { role: "user", text: trimmed }]);
    setQuestion("");
    setLoading(true);
    setError(null);

    try {
      const answer = await api.chatWithMovies(
        trimmed,
        messages.map(({ role, text, media }) => ({ role, text, media })),
      );
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: answer.text, images: answer.images, media: answer.media },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Flex direction="column" gap="4">
      <Card>
        <Flex direction="column" gap="4" style={{ minHeight: 200 }}>
          {messages.length === 0 && (
            <Text color="gray">Ask about your movie and TV library, e.g. &quot;Do I have the F1 movie?&quot; or &quot;Which shows do I own with Bryan Cranston?&quot; Follow-up questions keep the context of the conversation.</Text>
          )}
          {messages.map((message, i) => (
            <Flex key={i} direction="column" gap="1" align={message.role === "user" ? "end" : "start"}>
              <Badge color={message.role === "user" ? "blue" : "gray"}>
                {message.role === "user" ? "You" : "Assistant"}
              </Badge>
              <Box style={{ maxWidth: message.media?.length ? "100%" : "85%", width: message.media?.length ? "100%" : undefined }}>
                {message.role === "assistant" ? (
                  <ChatText text={message.text} />
                ) : (
                  <Text as="p" size="2" style={{ whiteSpace: "pre-wrap" }}>
                    {message.text}
                  </Text>
                )}
                {message.media && message.media.length > 0 && <MediaTable media={message.media} />}
                {message.images?.map((image, j) => (
                  <img
                    key={j}
                    src={`data:${image.mimeType};base64,${image.data}`}
                    alt="Result artwork"
                    width={160}
                    style={{ borderRadius: 6, marginTop: 8, display: "block" }}
                  />
                ))}
              </Box>
            </Flex>
          ))}
          {loading && <Text color="gray">Thinking…</Text>}
        </Flex>
      </Card>

      {error && (
        <Callout.Root color="red">
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      )}

      <form onSubmit={handleSubmit}>
        <Flex gap="2">
          <Box flexGrow="1">
            <TextField.Root
              placeholder='Ask a question, e.g. "Do I have the F1 movie?"'
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </Box>
          <Button type="submit" loading={loading}>
            Ask
          </Button>
          <Button
            type="button"
            variant="soft"
            color="gray"
            disabled={loading || messages.length === 0}
            onClick={() => {
              setMessages([]);
              setError(null);
            }}
          >
            New chat
          </Button>
        </Flex>
      </form>
    </Flex>
  );
}
