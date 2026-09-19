import { Fragment } from "react";
import { Box, Code, Text } from "@radix-ui/themes";

// The assistant writes light Markdown: **bold**, *italics*, `code`, "- " bullets
// and the occasional heading. Render just that (no tables, links or nesting)
// as real paragraphs and lists, instead of showing raw asterisks in a
// pre-wrapped blob.

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <Code key={i}>{part.slice(1, -1)}</Code>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block = { type: "p"; lines: string[] } | { type: "ul"; items: string[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let openParagraph = false;

  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^#{1,4}\s+/.test(rawLine);
    const line = heading ? rawLine.replace(/^#{1,4}\s+/, "") : rawLine;
    const bullet = heading ? null : BULLET.exec(line);
    const last = blocks[blocks.length - 1];

    if (line.trim() === "") {
      openParagraph = false;
    } else if (bullet) {
      if (last?.type === "ul") last.items.push(bullet[1] ?? "");
      else blocks.push({ type: "ul", items: [bullet[1] ?? ""] });
      openParagraph = false;
    } else if (heading) {
      blocks.push({ type: "p", lines: [`**${line.trim()}**`] });
      openParagraph = false;
    } else if (openParagraph && last?.type === "p") {
      last.lines.push(line);
    } else {
      blocks.push({ type: "p", lines: [line] });
      openParagraph = true;
    }
  }
  return blocks;
}

export function ChatText({ text }: { text: string }) {
  return (
    <Box>
      {parseBlocks(text).map((block, i) =>
        block.type === "ul" ? (
          <Box key={i} asChild mb="2" style={{ paddingLeft: 20, margin: 0 }}>
            <ul>
              {block.items.map((item, j) => (
                <li key={j} style={{ marginBottom: 2 }}>
                  <Text size="2">{renderInline(item)}</Text>
                </li>
              ))}
            </ul>
          </Box>
        ) : (
          <Text as="p" size="2" key={i} mb="2">
            {block.lines.map((line, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(line)}
              </Fragment>
            ))}
          </Text>
        )
      )}
    </Box>
  );
}
