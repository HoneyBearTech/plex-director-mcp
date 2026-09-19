import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, TextBlock, ToolResultBlockParam, ToolUnion, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { movieTools } from "../tools/movies.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MovieRow } from "../tools/plex.js";

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 4;

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const SYSTEM_PROMPT =
  "You are a media-library assistant for a home Plex/Radarr/Sonarr stack. " +
  "Use the available tools to answer questions about the movie library - never guess. Be concise and direct. " +
  "Tool results are authoritative: report every row a tool returns rather than filtering or dropping rows based on your own knowledge of the movie. " +
  "When a search tool returns a list of movies, the interface already displays them as a table with posters, so do not list the titles again in your reply - refer to the table (e.g. \"see the table below\") and add only a brief summary or remark. " +
  "Earlier messages in the conversation are included, so follow-ups such as \"what about the sequel?\" or \"which of those are in 4K?\" refer to them; a bracketed \"[Table shown to the user ...]\" note in an earlier answer lists the rows the user saw. " +
  "Use a tool's own filters (year range, owned/missing, genre, actor) to narrow results to exactly what was asked, since the table shows every row the tool returns.";

// A previous message in the conversation, as sent back by the browser.
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  // Rows the UI showed as a table under that assistant message.
  movies?: MovieRow[];
}

// Bounds on what the browser can feed back in: history is untrusted input
// that goes straight into the model's context, so cap its size.
const MAX_HISTORY_TURNS = 12;
const MAX_TURN_CHARS = 4000;
const MAX_SUMMARY_ROWS = 25;

// The model is told not to re-list titles the table already shows, which
// means its own earlier text often doesn't name them. Without them, a
// follow-up like "which of those are in 4K?" has nothing to refer to, so each
// earlier assistant turn is given a compact text form of the table too.
function describeTable(movies: MovieRow[]): string {
  const rows = movies.slice(0, MAX_SUMMARY_ROWS).map((m) => {
    const year = m.year ? ` (${m.year})` : "";
    const where = m.libraries === null ? "" : m.libraries.length === 0 ? " - not in Plex" : ` - in Plex: ${m.libraries.join(", ")}`;
    return `${m.title}${year}${where}`;
  });
  const more = movies.length > rows.length ? `; and ${movies.length - rows.length} more` : "";
  return `\n\n[Table shown to the user with this answer: ${rows.join("; ")}${more}]`;
}

// Turns the browser's history into API messages: most recent turns only, text
// only (tool calls aren't replayed), starting with a user message and strictly
// alternating roles, as the API expects.
export function buildHistoryMessages(history: ChatTurn[] = []): MessageParam[] {
  const messages: MessageParam[] = [];

  for (const turn of history.slice(-MAX_HISTORY_TURNS)) {
    if (turn.role !== "user" && turn.role !== "assistant") continue;
    let text = String(turn.text ?? "").slice(0, MAX_TURN_CHARS).trim();
    if (turn.role === "assistant" && Array.isArray(turn.movies) && turn.movies.length > 0) {
      text += describeTable(turn.movies);
    }
    if (!text) continue;

    const last = messages[messages.length - 1];
    if (!last && turn.role === "assistant") continue; // must start with a user turn
    if (last && last.role === turn.role) {
      // e.g. a question whose answer failed, followed by the next question.
      last.content = `${last.content as string}\n\n${text}`;
    } else {
      messages.push({ role: turn.role, content: text });
    }
  }

  // The new question is appended after this, so a trailing user turn would
  // collide with it; merge instead of sending two in a row.
  return messages;
}

export interface ChatImage {
  mimeType: string;
  data: string;
}

export interface ChatAnswer {
  text: string;
  images: ChatImage[];
  // Rows from search-style tools, shown by the UI as a table with posters.
  movies: MovieRow[];
}

function buildTools(): ToolUnion[] {
  return movieTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

export async function askMovieAssistant(question: string, history: ChatTurn[] = []): Promise<ChatAnswer> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }

  const anthropic = new Anthropic({ apiKey });
  const tools = buildTools();
  const images: ChatImage[] = [];
  const movies: MovieRow[] = [];
  const messages: MessageParam[] = buildHistoryMessages(history);
  const previous = messages[messages.length - 1];
  if (previous && previous.role === "user") {
    previous.content = `${previous.content as string}\n\n${question}`;
  } else {
    messages.push({ role: "user", content: question });
  }

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    const toolUses = response.content.filter((block): block is ToolUseBlock => block.type === "tool_use");

    if (toolUses.length === 0) {
      const text = response.content
        .filter((block): block is TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();
      return { text: text || "I couldn't come up with an answer for that.", images, movies };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const tool = movieTools.find((t) => t.name === use.name);
      const result: CallToolResult = tool
        ? await tool.handler(use.input as { title: string })
        : { content: [{ type: "text" as const, text: `Unknown tool "${use.name}"` }], isError: true };

      const rows = result.structuredContent?.movies;
      if (Array.isArray(rows)) movies.push(...(rows as MovieRow[]));

      const content: ToolResultBlockParam["content"] = [];
      for (const block of result.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "image" && SUPPORTED_IMAGE_TYPES.has(block.mimeType)) {
          content.push({
            type: "image",
            source: { type: "base64", media_type: block.mimeType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: block.data },
          });
          images.push({ mimeType: block.mimeType, data: block.data });
        }
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: use.id,
        content,
        is_error: "isError" in result ? Boolean(result.isError) : false,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { text: "I wasn't able to finish looking that up - the assistant hit its tool-call limit.", images, movies };
}
