import "./setup.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { renderSkill } from "../src/guidance.js";

const skillPath = path.resolve(import.meta.dirname, "..", "skills", "plex-director", "SKILL.md");

describe("Agent Skill (skills/plex-director/SKILL.md)", () => {
  it("matches the shared guidance - run `npm run build:skill` after editing src/guidance.ts", () => {
    assert.equal(fs.readFileSync(skillPath, "utf8"), renderSkill());
  });

  // https://agentskills.io/specification
  it("has frontmatter that meets the Agent Skills specification", () => {
    const match = /^---\n([\s\S]*?)\n---\n/.exec(renderSkill());
    assert.ok(match, "frontmatter block");
    const fields = Object.fromEntries(
      match[1]!.split("\n").map((line) => [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1).trim()])
    );
    assert.equal(fields.name, path.basename(path.dirname(skillPath)), "name must match the folder name");
    assert.match(fields.name!, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.ok(fields.name!.length <= 64);
    assert.ok(fields.description && fields.description.length <= 1024, `description is ${fields.description?.length} chars`);
    assert.ok(!fields.compatibility || fields.compatibility.length <= 500);
  });
});
