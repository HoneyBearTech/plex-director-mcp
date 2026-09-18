import { Fragment, useState } from "react";
import { Badge, Box, Button, Callout, Card, Code, Flex, Text, TextField } from "@radix-ui/themes";
import { api, type ChatImage } from "../api";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  images?: ChatImage[];
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
      const answer = await api.chatWithMovies(trimmed);
      setMessages((prev) => [...prev, { role: "assistant", text: answer.text, images: answer.images }]);
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
            <Text color="gray">Ask about your movie library, e.g. &quot;Do I have the F1 movie?&quot;</Text>
          )}
          {messages.map((message, i) => (
            <Flex key={i} direction="column" gap="1" align={message.role === "user" ? "end" : "start"}>
              <Badge color={message.role === "user" ? "blue" : "gray"}>
                {message.role === "user" ? "You" : "Assistant"}
              </Badge>
              <Box style={{ maxWidth: "85%" }}>
                <Text as="p" size="2" style={{ whiteSpace: "pre-wrap" }}>
                  {renderInlineMarkdown(message.text)}
                </Text>
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
        </Flex>
      </form>
    </Flex>
  );
}
