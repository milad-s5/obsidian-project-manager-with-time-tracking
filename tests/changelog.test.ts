import { test } from "node:test";
import assert from "node:assert/strict";
import { changelogSections, compareVersions, sectionsSince } from "../src/utils/Changelog";

const md = `# Changelog

## Unreleased
- not out yet

## 1.10.0
### New
- ten

## 1.9.2
- nine two

## 1.4.0
- four
`;

test("the changelog splits into versions, leaving out Unreleased", () => {
  const s = changelogSections(md);
  assert.deepEqual(s.map((x) => x.version), ["1.10.0", "1.9.2", "1.4.0"]);
  assert.equal(s[0].body, "### New\n- ten");
});

test("versions compare as numbers", () => {
  assert.ok(compareVersions("1.10.0", "1.9.2") > 0);
  assert.equal(compareVersions("1.5", "1.5.0"), 0);
});

test("after an update, every version since the last one seen is shown", () => {
  const s = changelogSections(md);
  assert.deepEqual(sectionsSince(s, "1.4.0", "1.10.0").map((x) => x.version), ["1.10.0", "1.9.2"]);
  assert.deepEqual(sectionsSince(s, "", "1.9.2").map((x) => x.version), ["1.9.2"]);
  assert.deepEqual(sectionsSince(s, "1.10.0", "1.10.0"), []);
});
