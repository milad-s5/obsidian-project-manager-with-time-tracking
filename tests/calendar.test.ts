import { test } from "node:test";
import assert from "node:assert/strict";
import { createCalendar, stripBidi } from "../src/utils/Calendar";

const greg = createCalendar("gregorian");
const jal = createCalendar("jalali");

test("weeks start on the calendar's own day unless told otherwise", () => {
  // 2026-10-04 is a Sunday
  assert.equal(greg.startOfWeek("2026-10-04"), "2026-09-28");
  assert.equal(jal.startOfWeek("2026-10-04"), "2026-10-03");
  assert.equal(createCalendar("gregorian", "sun").startOfWeek("2026-10-04"), "2026-10-04");
  assert.equal(createCalendar("jalali", "mon").startOfWeek("2026-10-04"), "2026-09-28");
});

test("weekday headers rotate with the week start", () => {
  assert.equal(greg.weekdaysShort[0], "Mon");
  assert.equal(jal.weekdaysShort[0], "ش");
  assert.equal(createCalendar("gregorian", "sat").weekdaysShort[0], "Sat");
});

test("month steps clamp to the last day of a shorter month", () => {
  assert.equal(greg.shiftMonths("2026-01-31", 1), "2026-02-28");
  // 31 Shahrivar 1405 → Mehr has 30 days
  assert.equal(jal.shiftMonths("2026-09-22", 1), "2026-10-22");
  assert.equal(jal.shiftMonths("2026-10-04", -12), "2025-10-04");
});

test("labels read in the calendar's own words", () => {
  assert.equal(greg.label("2026-10-04"), "4 October 2026");
  assert.equal(stripBidi(jal.label("2026-10-04")), "۱۲ مهر ۱۴۰۵");
  assert.equal(stripBidi(jal.weekdayLabel("2026-10-03")), "شنبه");
  assert.equal(greg.seasonLabel("2026-10-04"), "Q4 2026");
  assert.equal(stripBidi(jal.seasonLabel("2026-10-04")), "پاییز ۱۴۰۵");
});

test("period starts", () => {
  assert.equal(jal.startOfMonth("2026-10-04"), "2026-09-23");
  assert.equal(jal.startOfYear("2026-10-04"), "2026-03-21");
  assert.equal(greg.startOfSeason("2026-11-15"), "2026-10-01");
});

test("Jalali labels keep their own order inside left-to-right text", () => {
  assert.equal(jal.label("2026-10-04"), "\u2067۱۲ مهر ۱۴۰۵\u2069");
  assert.equal(greg.label("2026-10-04"), "4 October 2026", "Gregorian labels need no isolate");
});
