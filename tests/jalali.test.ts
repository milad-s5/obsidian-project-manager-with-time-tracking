import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, daysBetween, gregorianToJalali, isLeapJalaliYear, jalaliMonthLength,
  jalaliToGregorian, rangeDays, toISODate, toPersianDigits,
} from "../src/utils/Jalali";

test("Nowruz lands on the right Gregorian day", () => {
  assert.deepEqual(gregorianToJalali(2024, 3, 20), { jy: 1403, jm: 1, jd: 1 });
  assert.deepEqual(gregorianToJalali(2025, 3, 21), { jy: 1404, jm: 1, jd: 1 });
  assert.deepEqual(gregorianToJalali(2026, 3, 21), { jy: 1405, jm: 1, jd: 1 });
});

test("the last day of a leap year exists", () => {
  assert.equal(isLeapJalaliYear(1399), true);
  assert.equal(isLeapJalaliYear(1403), true);
  assert.equal(isLeapJalaliYear(1404), false);
  assert.equal(jalaliMonthLength(1403, 12), 30);
  assert.equal(jalaliMonthLength(1404, 12), 29);
  assert.deepEqual(jalaliToGregorian(1403, 12, 30), { gy: 2025, gm: 3, gd: 20 });
});

test("a decade of days survives the round trip", () => {
  const start = new Date(2020, 0, 1, 12);
  for (let i = 0; i < 3653; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const j = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const g = jalaliToGregorian(j.jy, j.jm, j.jd);
    assert.deepEqual(
      [g.gy, g.gm, g.gd],
      [d.getFullYear(), d.getMonth() + 1, d.getDate()],
      `round trip of ${toISODate(d)}`
    );
  }
});

test("day arithmetic on ISO strings ignores daylight saving", () => {
  assert.equal(addDays("2026-03-07", 2), "2026-03-09");
  assert.equal(addDays("2026-11-01", 1), "2026-11-02");
  assert.equal(daysBetween("2026-03-01", "2026-04-01"), 31);
  assert.deepEqual(rangeDays("2026-02-27", "2026-03-02"), ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
});

test("Persian digits", () => {
  assert.equal(toPersianDigits("1405-07-12"), "۱۴۰۵-۰۷-۱۲");
});
