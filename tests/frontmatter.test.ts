import { test } from "node:test";
import assert from "node:assert/strict";
import { MockApp, settle, TFile } from "./obsidian";
import { linkSlug, MAX_NAME_BYTES, renameHeading, shortenName, slugify, utf8Length, yamlString } from "../src/utils/FrontmatterUtils";

test("linkSlug reduces any link form to the note name", () => {
  assert.equal(linkSlug("[[alpha]]"), "alpha");
  assert.equal(linkSlug("[[Work/Archive/Tasks/beta|Beta]]"), "beta");
  assert.equal(linkSlug("[[gamma#Heading]]"), "gamma");
  assert.equal(linkSlug("[[delta.md]]"), "delta");
  assert.equal(linkSlug("plain"), "plain");
  assert.equal(linkSlug(undefined), "");
  assert.equal(linkSlug(null), "");
});

test("yamlString survives quotes, backslashes and newlines", () => {
  assert.equal(yamlString('He said "hi"'), '"He said \\"hi\\""');
  assert.equal(yamlString("C:\\path"), '"C:\\\\path"');
  assert.equal(yamlString("one\ntwo"), '"one two"');
});

test("slugify keeps Latin and Persian letters", () => {
  assert.equal(slugify("Hello World"), "hello-world");
  assert.equal(slugify("سلام دنیا"), "سلام-دنیا");
  assert.equal(slugify("  --A--b--  "), "a-b");
});

// ── renameHeading ── (moved here from the old _h-test.mjs scratch script)

async function renamed(content: string, from: string, to: string): Promise<string> {
  const app = new MockApp();
  const file = app.vault.seed("note.md", content);
  await renameHeading(app as never, file as TFile, from, to);
  await settle();
  return app.vault.contentOf(file);
}

const NOTE = `---
type: task
title: "Old name"
---

# Old name

## Time Log

| Date | Hours |
|------|-------|
`;

test("renameHeading renames the H1 and nothing else", async () => {
  const out = await renamed(NOTE, "Old name", "New name");
  assert.ok(out.includes("# New name"));
  assert.ok(!out.includes("# Old name"));
  assert.ok(out.includes("## Time Log"));
  assert.ok(out.includes('title: "Old name"'), "frontmatter is not this function's job");
});

test("renameHeading touches only the first match", async () => {
  const out = await renamed("# Dup\n\ntext\n\n# Dup\n", "Dup", "Once");
  assert.equal(out.split("# Once").length - 1, 1);
  assert.equal(out.split("# Dup").length - 1, 1);
});

test("renameHeading leaves hand-edited and deeper headings alone", async () => {
  const edited = "# Something else entirely\n\nbody\n";
  assert.equal(await renamed(edited, "Old name", "New name"), edited);
  assert.equal(await renamed("## Old name\n", "Old name", "New"), "## Old name\n");
});

test("renameHeading no-ops on unchanged or empty titles", async () => {
  assert.equal(await renamed(NOTE, "Old name", "Old name"), NOTE);
  assert.equal(await renamed(NOTE, "", "New"), NOTE);
  assert.equal(await renamed(NOTE, "Old name", "   "), NOTE);
});

test("renameHeading tolerates stray spaces", async () => {
  const out = await renamed("#  Old name  \n", " Old name ", "New");
  assert.ok(out.includes("# New"));
});

test("long titles make short file names that a phone can sync", () => {
  const long = "بررسی خرید مستر کارت یا ویزا کارت برای باز کردن حساب هایی مثل حساب گوگل برای انتشار گوگل اکستنشن";
  const slug = slugify(long);
  assert.ok(utf8Length(slug) <= MAX_NAME_BYTES, `${utf8Length(slug)} bytes`);
  assert.ok(!slug.endsWith("-"));
  assert.ok(long.replace(/ /g, "-").startsWith(slug), "cut, not changed");
  assert.equal(slugify("Short title"), "short-title");
  assert.equal(shortenName("a".repeat(200)).length, MAX_NAME_BYTES);
});
