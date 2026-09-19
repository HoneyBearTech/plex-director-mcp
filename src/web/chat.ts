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
  "Use a tool's own filters (year range, owned/missing, genre, actor) to narrow results to exactly what was asked, since the table shows every row the tool returns.";

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

export async function askMovieAssistant(question: string): Promise<ChatAnswer> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
  }

  const anthropic = new Anthropic({ apiKey });
  const tools = buildTools();
  const images: ChatImage[] = [];
  const movies: MovieRow[] = [];
  const messages: MessageParam[] = [{ role: "user", content: question }];

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
