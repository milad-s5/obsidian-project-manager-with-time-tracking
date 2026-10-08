import {
  MONTHS_FA, MONTHS_SHORT_FA, SEASONS_FA, WEEKDAYS_FA, WEEKDAYS_FULL_FA,
  addDays, daysBetween, gregorianToJalali, isoToDate, jalaliMonthLength,
  jalaliToGregorian, toISODate, toPersianDigits,
} from "./Jalali";

/**
 * The dashboard used to speak Jalali and nothing else, which made it unusable
 * for anyone outside Iran. Everything calendar-shaped now goes through this
 * interface, and the two implementations differ only in the handful of things
 * that genuinely differ between calendars.
 *
 * Day arithmetic — addDays, daysBetween, rangeDays — is deliberately *not* here.
 * Those work on ISO strings and mean the same thing in either calendar, so
 * duplicating them per calendar would only invite the two copies to drift.
 */
export type CalendarKind = "jalali" | "gregorian";

/** Which column a week starts on. "auto" follows the calendar's own custom. */
export type WeekStart = "auto" | "sat" | "sun" | "mon";

export interface CalendarDate {
  y: number;
  m: number;
  d: number;
}

export interface MonthGroup {
  y: number;
  m: number;
  isos: string[];
}

/** The parts that actually differ between calendars. */
interface CalendarCore {
  kind: CalendarKind;
  monthsLong: string[];
  monthsShort: string[];
  weekdaysShort: string[];
  weekdaysLong: string[];
  seasonNames: string[];
  /** The weekday this calendar conventionally starts a week on */
  defaultWeekStart: Exclude<WeekStart, "auto">;
  /** How this calendar's locale words a few labels the dashboard needs */
  words: { week: (label: string) => string; year: (y: string) => string; to: string; comma: string };
  fromISO(iso: string): CalendarDate;
  toISO(y: number, m: number, d: number): string;
  monthLength(y: number, m: number): number;
  digits(value: string | number): string;
}

export interface Calendar {
  kind: CalendarKind;
  weekdaysShort: string[];
  monthsShort: string[];
  fromISO(iso: string): CalendarDate;
  toISO(y: number, m: number, d: number): string;
  monthLength(y: number, m: number): number;
  /** "17 Mordad 1405" / "8 August 2026" */
  label(iso: string): string;
  /** "Mordad 1405" / "August 2026" */
  monthLabel(y: number, m: number): string;
  /** Full weekday name */
  weekdayLabel(iso: string): string;
  /** Weekday plus date, for a calendar cell's title */
  dayTitle(iso: string): string;
  seasonLabel(iso: string): string;
  /** "هفته‌ی ۱۷ مرداد ۱۴۰۵" / "Week of 8 August 2026" */
  weekLabel(iso: string): string;
  /** "سال ۱۴۰۵" / "2026" */
  yearLabel(iso: string): string;
  /** "۱ مرداد تا ۱۷ مرداد" / "1 August to 17 August" */
  rangeLabel(fromISO: string, toISO: string): string;
  digits(value: string | number): string;
  weekdayCol(iso: string): number;
  firstWeekdayCol(y: number, m: number): number;
  groupByMonth(isos: string[]): MonthGroup[];
  startOfWeek(iso: string): string;
  startOfMonth(iso: string): string;
  startOfSeason(iso: string): string;
  startOfYear(iso: string): string;
  shiftMonths(iso: string, delta: number): string;
}

// ── The two cores ───────────────────────────────────────────────────────

const JALALI_CORE: CalendarCore = {
  kind: "jalali",
  monthsLong: MONTHS_FA,
  monthsShort: MONTHS_SHORT_FA,
  weekdaysShort: WEEKDAYS_FA,
  weekdaysLong: WEEKDAYS_FULL_FA,
  seasonNames: SEASONS_FA,
  defaultWeekStart: "sat",
  words: {
    week: (label) => `هفته‌ی ${label}`,
    year: (y) => `سال ${y}`,
    to: "تا",
    comma: "،",
  },
  fromISO(iso) {
    const d = isoToDate(iso);
    const { jy, jm, jd } = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate());
    return { y: jy, m: jm, d: jd };
  },
  toISO(y, m, d) {
    const g = jalaliToGregorian(y, m, d);
    return `${String(g.gy).padStart(4, "0")}-${String(g.gm).padStart(2, "0")}-${String(g.gd).padStart(2, "0")}`;
  },
  monthLength: jalaliMonthLength,
  digits: toPersianDigits,
};

const MONTHS_EN = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_SHORT_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const GREGORIAN_CORE: CalendarCore = {
  kind: "gregorian",
  monthsLong: MONTHS_EN,
  monthsShort: MONTHS_SHORT_EN,
  // Stored Sunday-first, matching Date.getDay(); rotated later to the chosen start
  weekdaysShort: WEEKDAYS_SHORT_EN,
  weekdaysLong: WEEKDAYS_LONG_EN,
  seasonNames: ["Q1", "Q2", "Q3", "Q4"],
  defaultWeekStart: "mon",
  words: {
    week: (label) => `Week of ${label}`,
    year: (y) => y,
    to: "to",
    comma: ",",
  },
  fromISO(iso) {
    const d = isoToDate(iso);
    return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() };
  },
  toISO(y, m, d) {
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  },
  monthLength(y, m) {
    return new Date(y, m, 0).getDate();
  },
  digits(value) {
    return String(value);
  },
};

const START_DAY: Record<Exclude<WeekStart, "auto">, number> = { sun: 0, mon: 1, sat: 6 };

// ── One implementation over either core ─────────────────────────────────

/**
 * Wraps right-to-left text in a directional isolate (RLI … PDI).
 *
 * A Jalali label is read right to left, but it is usually dropped into
 * left-to-right text: a card's "📅 " line, a table cell, an English
 * sentence. There the Unicode bidi algorithm left the numbers where they
 * fell, so "۱۴ مهر ۱۴۰۵" was drawn as "مهر ۱۴۰۵ ۱۴". Isolated, it keeps its
 * own order wherever it lands, and in right-to-left text it changes nothing.
 */
export function isolateRtl(text: string): string {
  return `\u2067${text}\u2069`;
}

/** Removes the isolates again, for text going somewhere other than the screen */
export function stripBidi(text: string): string {
  return text.replace(/[\u2066-\u2069]/g, "");
}

function build(core: CalendarCore, weekStart: WeekStart): Calendar {
  const out = core.kind === "jalali" ? isolateRtl : (t: string) => t;
  const startDay = START_DAY[weekStart === "auto" ? core.defaultWeekStart : weekStart];

  /** 0 = the first column of the week, whichever weekday that is */
  const weekdayCol = (iso: string): number =>
    (isoToDate(iso).getDay() - startDay + 7) % 7;

  // Jalali's short names are already Saturday-first; Gregorian's are Sunday-first.
  // Rotating from each list's own base keeps both honest whatever the start is.
  const base = core.kind === "jalali" ? 6 : 0;
  const rotate = (names: string[]): string[] => {
    const shift = (startDay - base + 7) % 7;
    return names.slice(shift).concat(names.slice(0, shift));
  };

  const cal: Calendar = {
    kind: core.kind,
    weekdaysShort: rotate(core.weekdaysShort),
    monthsShort: core.monthsShort,
    fromISO: (iso) => core.fromISO(iso),
    toISO: (y, m, d) => core.toISO(y, m, d),
    monthLength: (y, m) => core.monthLength(y, m),
    digits: (v) => core.digits(v),
    weekdayCol,

    label(iso) {
      const { y, m, d } = core.fromISO(iso);
      return out(`${core.digits(d)} ${core.monthsLong[m - 1]} ${core.digits(y)}`);
    },

    monthLabel(y, m) {
      return out(`${core.monthsLong[m - 1]} ${core.digits(y)}`);
    },

    weekdayLabel(iso) {
      // Indexed by the real weekday, not the display column
      const day = isoToDate(iso).getDay();
      const idx = core.kind === "jalali" ? (day + 1) % 7 : day;
      return out(core.weekdaysLong[idx]);
    },

    dayTitle(iso) {
      return out(`${cal.weekdayLabel(iso)}${core.words.comma} ${cal.label(iso)}`);
    },

    weekLabel(iso) {
      return out(core.words.week(cal.label(iso)));
    },

    yearLabel(iso) {
      return out(core.words.year(core.digits(core.fromISO(iso).y)));
    },

    rangeLabel(fromISO, toISO) {
      return out(`${cal.label(fromISO)} ${core.words.to} ${cal.label(toISO)}`);
    },

    seasonLabel(iso) {
      const { y, m } = core.fromISO(iso);
      const season = Math.floor((m - 1) / 3);
      return out(`${core.seasonNames[season]} ${core.digits(y)}`);
    },

    firstWeekdayCol(y, m) {
      return weekdayCol(core.toISO(y, m, 1));
    },

    groupByMonth(isos) {
      const out: MonthGroup[] = [];
      let cur: MonthGroup | null = null;
      for (const iso of isos) {
        const { y, m } = core.fromISO(iso);
        if (!cur || cur.y !== y || cur.m !== m) {
          cur = { y, m, isos: [] };
          out.push(cur);
        }
        cur.isos.push(iso);
      }
      return out;
    },

    startOfWeek(iso) {
      return addDays(iso, -weekdayCol(iso));
    },

    startOfMonth(iso) {
      const { y, m } = core.fromISO(iso);
      return core.toISO(y, m, 1);
    },

    startOfSeason(iso) {
      const { y, m } = core.fromISO(iso);
      return core.toISO(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
    },

    startOfYear(iso) {
      const { y } = core.fromISO(iso);
      return core.toISO(y, 1, 1);
    },

    shiftMonths(iso, delta) {
      const { y, m, d } = core.fromISO(iso);
      const total = (y * 12 + (m - 1)) + delta;
      const ny = Math.floor(total / 12);
      const nm = (total % 12) + 1;
      // Clamp, because the 31st does not exist in every month and a leap day
      // only exists in some years
      return core.toISO(ny, nm, Math.min(d, core.monthLength(ny, nm)));
    },
  };

  return cal;
}

export function createCalendar(kind: CalendarKind, weekStart: WeekStart = "auto"): Calendar {
  return build(kind === "gregorian" ? GREGORIAN_CORE : JALALI_CORE, weekStart);
}

export { addDays, daysBetween, toISODate };
