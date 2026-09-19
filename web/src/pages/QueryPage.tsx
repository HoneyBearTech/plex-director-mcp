import { Fragment, useState } from "react";
import { Badge, Box, Button, Callout, Card, Code, Flex, Table, Text, TextField } from "@radix-ui/themes";
import { api, type ChatImage, type MovieRow } from "../api";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
  movies?: MovieRow[];
}

// Claude's replies use light markdown (bold and inline code, mostly) -
// render just enough of it to avoid showing raw "**F1**" / `path` markers
// in the chat bubble.
function renderInlineMarkdown(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <Code key={i}>{part.slice(1, -1)}</Code>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
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

// Search results as a table with the poster next to each movie. "In Plex"
// only appears when a tool actually checked ownership (libraries !== null).
function MovieTable({ movies }: { movies: MovieRow[] }) {
  const showOwnership = movies.some((m) => m.libraries !== null);
  const showRating = movies.some((m) => m.rating !== null);
  const showDetail = movies.some((m) => m.genres.length > 0 || m.detail);

  return (
    <Table.Root size="1" variant="surface" style={{ marginTop: 8 }}>
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell width="56px" />
          <Table.ColumnHeaderCell>Title</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Year</Table.ColumnHeaderCell>
          {showOwnership && <Table.ColumnHeaderCell>In Plex</Table.ColumnHeaderCell>}
          {showDetail && <Table.ColumnHeaderCell>Details</Table.ColumnHeaderCell>}
          {showRating && <Table.ColumnHeaderCell>Rating</Table.ColumnHeaderCell>}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {movies.map((movie, i) => (
          <Table.Row key={i} align="center">
            <Table.Cell>
              <PosterThumb src={movie.posterUrl} title={movie.title} />
            </Table.Cell>
            <Table.RowHeaderCell>{movie.title}</Table.RowHeaderCell>
            <Table.Cell>{movie.year ?? "-"}</Table.Cell>
            {showOwnership && (
              <Table.Cell>
                {movie.libraries === null ? (
                  "-"
                ) : movie.libraries.length === 0 ? (
                  <Badge color="gray">Not in Plex</Badge>
                ) : (
                  <Flex gap="1" wrap="wrap">
                    {movie.libraries.map((library) => (
                      <Badge key={library} color="green">
                        {library}
                      </Badge>
                    ))}
                  </Flex>
                )}
              </Table.Cell>
            )}
            {showDetail && <Table.Cell>{movie.detail ?? movie.genres.join(", ")}</Table.Cell>}
            {showRating && <Table.Cell>{movie.rating !== null ? movie.rating.toFixed(1) : "-"}</Table.Cell>}
          </Table.Row>
        ))}
      </Table.Body>
    </Table.Root>
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
        messages.map(({ role, text, movies }) => ({ role, text, movies })),
      );
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: answer.text, images: answer.images, movies: answer.movies },
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
            <Text color="gray">Ask about your movie library, e.g. &quot;Do I have the F1 movie?&quot; Follow-up questions keep the context of the conversation.</Text>
          )}
          {messages.map((message, i) => (
            <Flex key={i} direction="column" gap="1" align={message.role === "user" ? "end" : "start"}>
              <Badge color={message.role === "user" ? "blue" : "gray"}>
                {message.role === "user" ? "You" : "Assistant"}
              </Badge>
              <Box style={{ maxWidth: message.movies?.length ? "100%" : "85%", width: message.movies?.length ? "100%" : undefined }}>
                <Text as="p" size="2" style={{ whiteSpace: "pre-wrap" }}>
                  {renderInlineMarkdown(message.text)}
                </Text>
                {message.movies && message.movies.length > 0 && <MovieTable movies={message.movies} />}
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
