import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, TextBlock, ToolResultBlockParam, ToolUnion, ToolUseBlock } from "@anthropic-ai/sdk/resources/messages";
import { movieTools } from "../tools/movies.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { MediaRow } from "../tools/plex.js";

const MODEL = "claude-sonnet-5";
const MAX_TOOL_ROUNDS = 4;

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const SYSTEM_PROMPT = [
  "You are a media-library assistant for a home Plex/Radarr/Sonarr stack. Use the available tools to answer questions about the movie and TV library - never guess. Tool results are authoritative: report what a tool returns rather than dropping or second-guessing rows based on your own knowledge of a movie.",

  "HOW RESULTS ARE SHOWN: when a search tool returns movies or shows, the interface displays them to the user as a table with posters directly BELOW your reply, one row per title with the Plex libraries that hold it (shows also get season and episode counts and watch progress; Sonarr completeness results show how many aired episodes are downloaded instead of libraries). The table always contains everything the tool returned, so never say anything is missing from it, never mention rows, limits, paging, offsets or 'the first N', and refer to it as \"the table below\" (never \"above\").",

  "FILTERS: the table shows exactly the rows the tool returned, so express any narrowing the user asks for as a tool filter (year range, owned/missing, genre, actor, library such as 4K, mediaType movie or show) - never filter a tool's results yourself in your reply. For a follow-up like \"which of those are 4K?\", run the search again with the earlier filters plus the new one (e.g. library \"4k\"). If the user asks for everything, request the maximum limit, and if the tool says more titles remain, fetch the next page with the offset it gives. Earlier messages in the conversation are included, so follow-ups such as \"what about the sequel?\" refer to them; a bracketed \"[Table shown to the user ...]\" note in an earlier answer lists the titles the user saw - the interface adds that note to earlier turns for your information, so never write one in your own reply.",

  "REPLY STYLE (this is shown in a chat window, so keep it clean and scannable): start with the answer in one or two short sentences - the number that matters and what the table shows. Add up to three short '- ' bullet points only if they add something useful (a highlight, a caveat, an offer of a next step), each under about 15 words. Never write a paragraph, never list more than three example titles in a row, no long parenthetical lists. Use **bold** sparingly for the key number or title; avoid other Markdown, and no tables or headings. Be concise and direct.",
].join("\n\n");

// What the results table should show after a tool call. A new search replaces
// what was there - the model often runs a broad search, then a narrower one,
// and the user should see only the set the answer is about, not both. Only a
// page continuation (offset > 0) adds to the previous rows, and it skips rows
// already in the table: the model only reads the first 100 rows of a long
// result and has been seen asking for "the rest" that the user already had.
export function mergeToolRows(current: MediaRow[], structured: unknown): MediaRow[] {
  const content = structured as { media?: unknown; append?: unknown } | undefined;
  if (!content || !Array.isArray(content.media)) return current;
  const rows = content.media as MediaRow[];
  if (content.append !== true) return rows;

  const key = (m: MediaRow) => `${m.kind}|${m.title}|${m.year}|${(m.libraries ?? []).join(",")}`;
  const seen = new Set(current.map(key));
  return [...current, ...rows.filter((m) => !seen.has(key(m)))];
}

// A previous message in the conversation, as sent back by the browser.
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
  // Rows the UI showed as a table under that assistant message.
  media?: MediaRow[];
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
function describeTable(media: MediaRow[]): string {
  const rows = media.slice(0, MAX_SUMMARY_ROWS).map((m) => {
    const year = m.year ? ` (${m.year})` : "";
    const kind = m.kind === "show" ? " [TV show]" : "";
    const where = m.libraries === null ? "" : m.libraries.length === 0 ? " - not in Plex" : ` - in Plex: ${m.libraries.join(", ")}`;
    return `${m.title}${year}${kind}${where}`;
  });
  const more = media.length > rows.length ? `; and ${media.length - rows.length} more` : "";
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
    if (turn.role === "assistant" && Array.isArray(turn.media) && turn.media.length > 0) {
      text += describeTable(turn.media);
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
  media: MediaRow[];
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
  const media: MediaRow[] = [];
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
      return { text: text || "I couldn't come up with an answer for that.", images, media };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolResults: ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const tool = movieTools.find((t) => t.name === use.name);
      const result: CallToolResult = tool
        ? await tool.handler(use.input as { title: string })
        : { content: [{ type: "text" as const, text: `Unknown tool "${use.name}"` }], isError: true };

      media.splice(0, media.length, ...mergeToolRows(media, result.structuredContent));

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

  return { text: "I wasn't able to finish looking that up - the assistant hit its tool-call limit.", images, media };
}
