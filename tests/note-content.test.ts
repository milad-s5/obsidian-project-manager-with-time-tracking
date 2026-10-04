import { test } from "node:test";
import assert from "node:assert/strict";
import { readBodyNotes, stripFrontmatter } from "../src/utils/NoteContent";

const TEMPLATE = `---
type: task
title: "Write report"
---

# Write report

## Time Log

| Date | Hours | Start | End |
|------|-------|-------|-----|
| 2026-10-04 | 1 | a | b |
`;

test("a note that is only the template has no notes", () => {
  assert.deepEqual(readBodyNotes(TEMPLATE), { hasNotes: false, excerpt: "" });
});

test("anything beyond the template is the user's own", () => {
  const info = readBodyNotes(`${TEMPLATE}\nCall the client first.\n`);
  assert.equal(info.hasNotes, true);
  assert.equal(info.excerpt, "Call the client first.");
});

test("jottings above the title count too", () => {
  const info = readBodyNotes("---\na: 1\n---\nidea\n# Title\n");
  assert.equal(info.excerpt, "idea");
});

test("stripFrontmatter leaves a note without frontmatter alone", () => {
  assert.equal(stripFrontmatter("# Just a note\n"), "# Just a note\n");
});
