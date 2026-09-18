import { describe, expect, it } from "vitest";
import {
  addDays,
  canClaim,
  canRelease,
  expandWeekly,
  findClashes,
  formatRange,
  formatTimeOfDay,
  isDateString,
  isOnBlockGrid,
  isPast,
  overlaps,
  parseTimeOfDay,
  startOfWeek,
  todayInZone,
  validateSeries,
  weekdayOf,
  weekDates,
  type Weekday,
} from "@/lib/schedule";

describe("parseTimeOfDay", () => {
  it("takes the shapes people actually type", () => {
    expect(parseTimeOfDay("8:00")).toBe(480);
    expect(parseTimeOfDay("08:00")).toBe(480);
    expect(parseTimeOfDay("8:00 AM")).toBe(480);
    expect(parseTimeOfDay("8am")).toBe(480);
    expect(parseTimeOfDay("9:30")).toBe(570);
    expect(parseTimeOfDay("12:00 AM")).toBe(0);
    expect(parseTimeOfDay("12:00 PM")).toBe(720);
    expect(parseTimeOfDay("8:00 PM")).toBe(1200);
    expect(parseTimeOfDay("20:30")).toBe(1230);
  });

  it("rejects nonsense rather than guessing", () => {
    for (const bad of ["", "abc", "25:00", "8:75", "13:00 PM", "0:00 AM", "8:0"]) {
      expect(parseTimeOfDay(bad), bad).toBeNull();
    }
  });
});

describe("formatting", () => {
  it("renders minutes back as a clock time", () => {
    expect(formatTimeOfDay(480)).toBe("8:00 AM");
    expect(formatTimeOfDay(570)).toBe("9:30 AM");
    expect(formatTimeOfDay(720)).toBe("12:00 PM");
    expect(formatTimeOfDay(0)).toBe("12:00 AM");
    expect(formatTimeOfDay(1230)).toBe("8:30 PM");
  });

  it("drops the repeated meridiem inside a range", () => {
    expect(formatRange(480, 570)).toBe("8:00 – 9:30 AM");
    expect(formatRange(690, 780)).toBe("11:30 AM – 1:00 PM");
  });
});

describe("dates", () => {
  it("rejects dates that do not exist", () => {
    expect(isDateString("2026-11-08")).toBe(true);
    expect(isDateString("2026-02-31")).toBe(false);
    expect(isDateString("2026-13-01")).toBe(false);
    expect(isDateString("26-11-08")).toBe(false);
    expect(isDateString("2026-11-8")).toBe(false);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-11-08", 7)).toBe("2026-11-15");
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("knows the weekday", () => {
    expect(weekdayOf("2026-09-20")).toBe(0); // Sunday
    expect(weekdayOf("2026-09-26")).toBe(6); // Saturday
  });

  it("starts the week on Sunday", () => {
    expect(startOfWeek("2026-09-23")).toBe("2026-09-20");
    expect(startOfWeek("2026-09-20")).toBe("2026-09-20");
    expect(weekDates("2026-09-20")).toHaveLength(7);
    expect(weekDates("2026-09-20")[6]).toBe("2026-09-26");
  });

  it("reads today in the facility's timezone, not the server's", () => {
    // 02:30 UTC on the 9th is still the 8th in Chicago.
    const instant = new Date("2026-11-09T02:30:00Z");
    expect(todayInZone("America/Chicago", instant)).toBe("2026-11-08");
    expect(todayInZone("UTC", instant)).toBe("2026-11-09");
  });
});

describe("expandWeekly", () => {
  it("lists every matching date, both bounds inclusive", () => {
    const dates = expandWeekly({ weekday: 6, startsOn: "2026-09-20", endsOn: "2026-10-17" });
    expect(dates).toEqual(["2026-09-26", "2026-10-03", "2026-10-10", "2026-10-17"]);
  });

  it("includes the start date when it is already the right weekday", () => {
    const dates = expandWeekly({ weekday: 6, startsOn: "2026-09-26", endsOn: "2026-10-03" });
    expect(dates).toEqual(["2026-09-26", "2026-10-03"]);
  });

  it("holds 8:00 at 8:00 straight through a daylight-saving change", () => {
    // US DST begins 8 March 2026. The whole point of storing a date plus
    // minutes is that every Saturday here is still 8:00 local.
    const dates = expandWeekly({ weekday: 6, startsOn: "2026-02-28", endsOn: "2026-03-21" });
    expect(dates).toEqual(["2026-02-28", "2026-03-07", "2026-03-14", "2026-03-21"]);
    // and the run is unbroken — no date skipped or doubled around the change
    for (let i = 1; i < dates.length; i += 1) {
      expect(addDays(dates[i - 1]!, 7)).toBe(dates[i]);
    }
  });

  it("covers the example: Saturdays from late September to the end of April", () => {
    const dates = expandWeekly({ weekday: 6, startsOn: "2026-09-20", endsOn: "2027-04-30" });
    expect(dates[0]).toBe("2026-09-26");
    expect(dates.at(-1)).toBe("2027-04-24"); // the last Saturday on or before 30 Apr
    expect(dates).toHaveLength(31);
    expect(new Set(dates.map(weekdayOf))).toEqual(new Set([6]));
  });

  it("returns nothing for a backwards or empty range", () => {
    expect(expandWeekly({ weekday: 6, startsOn: "2026-10-01", endsOn: "2026-09-01" })).toEqual([]);
    expect(expandWeekly({ weekday: 1, startsOn: "2026-09-22", endsOn: "2026-09-27" })).toEqual([
      "2026-09-28",
    ].filter((d) => d <= "2026-09-27"));
  });

  it("refuses a malformed date instead of inventing one", () => {
    expect(expandWeekly({ weekday: 6, startsOn: "nope", endsOn: "2026-10-01" })).toEqual([]);
  });
});

describe("overlaps", () => {
  const block = { startMinutes: 480, endMinutes: 570 }; // 8:00–9:30

  it("is half-open, so back-to-back blocks do not clash", () => {
    expect(overlaps(block, { startMinutes: 570, endMinutes: 600 })).toBe(false);
    expect(overlaps(block, { startMinutes: 420, endMinutes: 480 })).toBe(false);
  });

  it("catches every kind of genuine overlap", () => {
    expect(overlaps(block, { startMinutes: 450, endMinutes: 510 })).toBe(true); // straddles start
    expect(overlaps(block, { startMinutes: 540, endMinutes: 600 })).toBe(true); // straddles end
    expect(overlaps(block, { startMinutes: 500, endMinutes: 520 })).toBe(true); // inside
    expect(overlaps(block, { startMinutes: 400, endMinutes: 700 })).toBe(true); // encloses
    expect(overlaps(block, block)).toBe(true);
  });
});

describe("findClashes", () => {
  const existing = [
    { id: "a", date: "2026-10-03", startMinutes: 480, endMinutes: 570 },
    { id: "b", date: "2026-10-10", startMinutes: 600, endMinutes: 660 },
  ];

  it("only reports a clash on the same date", () => {
    const proposed = [
      { date: "2026-09-26", startMinutes: 480, endMinutes: 570 },
      { date: "2026-10-03", startMinutes: 480, endMinutes: 570 },
      { date: "2026-10-10", startMinutes: 480, endMinutes: 570 },
    ];
    const clashes = findClashes(proposed, existing);
    expect(clashes).toHaveLength(1);
    expect(clashes[0]!.date).toBe("2026-10-03");
    expect(clashes[0]!.against.id).toBe("a");
  });

  it("finds nothing when the times miss each other", () => {
    expect(
      findClashes([{ date: "2026-10-03", startMinutes: 570, endMinutes: 600 }], existing),
    ).toEqual([]);
  });
});

describe("validateSeries", () => {
  const ok = {
    weekday: 6,
    startMinutes: 480,
    endMinutes: 570,
    startsOn: "2026-09-20",
    endsOn: "2027-04-30",
  };

  it("accepts a well-formed series", () => {
    expect(validateSeries(ok)).toEqual([]);
  });

  it("requires the 30-minute grid", () => {
    expect(validateSeries({ ...ok, startMinutes: 485 })).toContainEqual(
      expect.stringContaining("30-minute"),
    );
  });

  it("requires the end after the start", () => {
    expect(validateSeries({ ...ok, endMinutes: 480 })).toContainEqual(
      expect.stringContaining("after the start time"),
    );
  });

  it("rejects a backwards date range", () => {
    expect(validateSeries({ ...ok, endsOn: "2026-01-01" })).toContainEqual(
      expect.stringContaining("before the start date"),
    );
  });

  it("does not impose the 1.5-hour request cap on assigned time", () => {
    // A club may assign a team a three-hour block; the cap is for coach requests.
    expect(validateSeries({ ...ok, startMinutes: 480, endMinutes: 660 })).toEqual([]);
  });

  it("rejects a block running past midnight", () => {
    expect(validateSeries({ ...ok, startMinutes: 1410, endMinutes: 1500 })).toContainEqual(
      expect.stringContaining("past midnight"),
    );
  });

  it("rejects a weekday outside the week", () => {
    expect(validateSeries({ ...ok, weekday: 7 })).toContainEqual(
      expect.stringContaining("day of the week"),
    );
  });
});

describe("isOnBlockGrid", () => {
  it("accepts half-hour boundaries only", () => {
    expect(isOnBlockGrid(480)).toBe(true);
    expect(isOnBlockGrid(510)).toBe(true);
    expect(isOnBlockGrid(495)).toBe(false);
    expect(isOnBlockGrid(-30)).toBe(false);
  });
});

describe("release and claim", () => {
  const held = {
    id: "1",
    date: "2026-10-03",
    startMinutes: 480,
    endMinutes: 570,
    status: "HELD" as const,
    origin: "ASSIGNED" as const,
    teamId: "team-a",
  };
  const released = { ...held, status: "RELEASED" as const, teamId: null };

  const coachA = { role: "HEAD_COACH" as const, teamId: "team-a" };
  const coachB = { role: "HEAD_COACH" as const, teamId: "team-b" };
  const admin = { role: "SUPER_ADMIN" as const, teamId: null };
  const approver = { role: "APPROVER" as const, teamId: null };

  it("lets the holding team give their own slot back", () => {
    expect(canRelease(held, coachA)).toBe(true);
  });

  it("does not let another team release someone else's slot", () => {
    expect(canRelease(held, coachB)).toBe(false);
    expect(canRelease(held, approver)).toBe(false);
  });

  it("lets an admin release on a team's behalf", () => {
    expect(canRelease(held, admin)).toBe(true);
  });

  it("cannot release what is already released", () => {
    expect(canRelease(released, coachA)).toBe(false);
    expect(canRelease(released, admin)).toBe(false);
  });

  it("lets any team with a coach claim released time", () => {
    expect(canClaim(released, coachB)).toBe(true);
    expect(canClaim(released, coachA)).toBe(true);
  });

  it("will not let staff without a team claim", () => {
    expect(canClaim(released, admin)).toBe(false);
    expect(canClaim(released, approver)).toBe(false);
  });

  it("cannot claim a slot that is still held", () => {
    expect(canClaim(held, coachB)).toBe(false);
  });

  it("treats yesterday as history", () => {
    expect(isPast({ date: "2026-10-02" }, "2026-10-03")).toBe(true);
    expect(isPast({ date: "2026-10-03" }, "2026-10-03")).toBe(false);
  });
});

describe("weekday type", () => {
  it("covers the whole week", () => {
    const all: Weekday[] = [0, 1, 2, 3, 4, 5, 6];
    expect(all.map((d) => weekdayOf(addDays("2026-09-20", d)))).toEqual(all);
  });
});
