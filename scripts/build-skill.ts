// Writes skills/plex-director/SKILL.md from the shared guidance in
// src/guidance.ts. Run `npm run build:skill` after changing that file;
// test/skill.test.ts fails while the committed copy is out of date.
import fs from "node:fs";
import path from "node:path";
import { renderSkill } from "../src/guidance.js";

const target = path.resolve(import.meta.dirname, "..", "skills", "plex-director", "SKILL.md");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, renderSkill());
console.log(`wrote ${path.relative(process.cwd(), target)}`);
