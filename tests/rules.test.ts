import { describe, expect, it } from "vitest";
import {
  closedBands,
  closureFor,
  dayAgenda,
  countsTowardWeeklyLimit,
  daysBetween,
  DEFAULT_SETTINGS,
  describeLength,
  lengthChoices,
  minutesBetween,
  openingsFor,
  validateRequest,
  withEnoughNotice,
  type ClosureRange,
  type DayHours,
  type RequestContext,
} from "@/lib/rules";

const settings = DEFAULT_SETTINGS;

// Thursday: the facility takes requests 3:00–9:00 PM.
const thursday: DayHours = { weekday: 4, isOpen: true, openMinutes: 900, closeMinutes: 1260 };

describe("daysBetween", () => {
  it("counts across a month boundary", () => {
    expect(daysBetween("2026-02-28", "2026-03-01")).toBe(1);
    expect(daysBetween("2026-11-28", "2026-12-05")).toBe(7);
    expect(daysBetween("2026-12-28", "2027-01-04")).toBe(7);
  });

  it("is zero for the same day and negative going backwards", () => {
    expect(daysBetween("2026-10-03", "2026-10-03")).toBe(0);
    expect(daysBetween("2026-10-03", "2026-10-01")).toBe(-2);
  });
});

describe("minutesBetween", () => {
  it("spans days in local wall-clock minutes", () => {
    expect(minutesBetween("2026-10-01", 1200, "2026-10-02", 1200)).toBe(1440);
    expect(minutesBetween("2026-10-01", 1200, "2026-10-02", 900)).toBe(1140);
  });
});

describe("openingsFor", () => {
  it("offers every half hour when the day is empty", () => {
    const openings = openingsFor(thursday, [], settings);
    expect(openings[0]).toEqual({ startMinutes: 900, maxMinutes: 90 });
    // last usable start is 8:30 PM, with only 30 minutes left before close
    expect(openings.at(-1)).toEqual({ startMinutes: 1230, maxMinutes: 30 });
  });

  it("caps a run at the request maximum, not the closing time", () => {
    const [first] = openingsFor(thursday, [], settings);
    expect(first!.maxMinutes).toBe(settings.maxRequestMinutes);
  });

  it("shortens the run leading up to a booked block", () => {
    // 4:30–6:00 PM taken
    const openings = openingsFor(thursday, [{ startMinutes: 990, endMinutes: 1080 }], settings);
    const at4 = openings.find((o) => o.startMinutes === 960); // 4:00 PM
    expect(at4?.maxMinutes).toBe(30); // only until 4:30
  });

  it("drops start times that are taken outright", () => {
    const openings = openingsFor(thursday, [{ startMinutes: 990, endMinutes: 1080 }], settings);
    for (const start of [990, 1020, 1050]) {
      expect(openings.some((o) => o.startMinutes === start), String(start)).toBe(false);
    }
  });

  it("offers the slot that starts exactly when another ends", () => {
    const openings = openingsFor(thursday, [{ startMinutes: 990, endMinutes: 1080 }], settings);
    expect(openings.some((o) => o.startMinutes === 1080)).toBe(true);
  });

  it("offers nothing on a closed day", () => {
    expect(openingsFor({ ...thursday, isOpen: false }, [], settings)).toEqual([]);
  });
});

describe("withEnoughNotice", () => {
  const openings = [
    { startMinutes: 900, maxMinutes: 90 },
    { startMinutes: 1080, maxMinutes: 90 },
  ];

  it("drops starts the notice period rules out", () => {
    // 9:00 AM today, 24 hours' notice: nothing later today qualifies.
    expect(
      withEnoughNotice(openings, {
        date: "2026-09-17",
        today: "2026-09-17",
        nowMinutes: 540,
        minNoticeHours: 24,
      }),
    ).toEqual([]);
  });

  it("keeps a start far enough out", () => {
    expect(
      withEnoughNotice(openings, {
        date: "2026-09-19",
        today: "2026-09-17",
        nowMinutes: 540,
        minNoticeHours: 24,
      }),
    ).toEqual(openings);
  });

  it("splits a day where the notice period lands mid-afternoon", () => {
    // 4:00 PM the day before: 3:00 PM tomorrow is an hour short, 6:00 PM is not.
    expect(
      withEnoughNotice(openings, {
        date: "2026-09-18",
        today: "2026-09-17",
        nowMinutes: 960,
        minNoticeHours: 24,
      }),
    ).toEqual([{ startMinutes: 1080, maxMinutes: 90 }]);
  });

  it("keeps everything when the club asks for no notice at all", () => {
    expect(
      withEnoughNotice(openings, {
        date: "2026-09-17",
        today: "2026-09-17",
        nowMinutes: 540,
        minNoticeHours: 0,
      }),
    ).toEqual(openings);
  });
});

describe("closedBands", () => {
  // The grid shows 8:00 AM to 9:00 PM; Thursday takes requests 3:00–9:00 PM.
  const WINDOW_START = 480;
  const WINDOW_END = 1260;

  it("shades the morning a weekday does not take requests in", () => {
    expect(closedBands(thursday, false, WINDOW_START, WINDOW_END)).toEqual([
      { fromMinutes: 480, toMinutes: 900 },
    ]);
  });

  it("shades both ends when the day closes before the window does", () => {
    const saturday: DayHours = { weekday: 6, isOpen: true, openMinutes: 540, closeMinutes: 1200 };
    expect(closedBands(saturday, false, WINDOW_START, WINDOW_END)).toEqual([
      { fromMinutes: 480, toMinutes: 540 },
      { fromMinutes: 1200, toMinutes: 1260 },
    ]);
  });

  it("shades nothing when the facility is open across the whole window", () => {
    const allDay: DayHours = { weekday: 0, isOpen: true, openMinutes: 480, closeMinutes: 1260 };
    expect(closedBands(allDay, false, WINDOW_START, WINDOW_END)).toEqual([]);
  });

  it("shades the whole window on a day that takes no requests", () => {
    const shut: DayHours = { weekday: 1, isOpen: false, openMinutes: 900, closeMinutes: 1260 };
    expect(closedBands(shut, false, WINDOW_START, WINDOW_END)).toEqual([
      { fromMinutes: 480, toMinutes: 1260 },
    ]);
  });

  it("shades the whole window on a closure, whatever the weekly hours say", () => {
    expect(closedBands(thursday, true, WINDOW_START, WINDOW_END)).toEqual([
      { fromMinutes: 480, toMinutes: 1260 },
    ]);
  });

  it("never shades past the window, however wide the hours are", () => {
    const wide: DayHours = { weekday: 3, isOpen: true, openMinutes: 0, closeMinutes: 1439 };
    expect(closedBands(wide, false, WINDOW_START, WINDOW_END)).toEqual([]);
  });
});

describe("lengthChoices", () => {
  it("offers 30, 60 and 90 minutes when there is room", () => {
    expect(lengthChoices(settings, 90)).toEqual([30, 60, 90]);
  });

  it("only offers what fits", () => {
    expect(lengthChoices(settings, 60)).toEqual([30, 60]);
    expect(lengthChoices(settings, 30)).toEqual([30]);
    expect(lengthChoices(settings, 0)).toEqual([]);
  });
});

describe("describeLength", () => {
  it("reads the way a coach would say it", () => {
    expect(describeLength(30)).toBe("30 min");
    expect(describeLength(60)).toBe("1 hour");
    expect(describeLength(90)).toBe("1.5 hours");
    expect(describeLength(180)).toBe("3 hours");
  });
});

describe("closureFor", () => {
  const closures: ClosureRange[] = [
    { startDate: "2026-11-26", endDate: "2026-11-26", reason: "Thanksgiving" },
    { startDate: "2026-12-24", endDate: "2026-12-25", reason: "Holiday closure" },
  ];

  it("matches a single day and both ends of a range", () => {
    expect(closureFor("2026-11-26", closures)?.reason).toBe("Thanksgiving");
    expect(closureFor("2026-12-24", closures)?.reason).toBe("Holiday closure");
    expect(closureFor("2026-12-25", closures)?.reason).toBe("Holiday closure");
  });

  it("does not match the day either side", () => {
    expect(closureFor("2026-11-25", closures)).toBeNull();
    expect(closureFor("2026-12-26", closures)).toBeNull();
  });
});

describe("validateRequest", () => {
  const base: RequestContext = {
    settings,
    hours: thursday,
    closures: [],
    taken: [],
    today: "2026-09-18",
    nowMinutes: 9 * 60, // 9:00 AM
    approvedThisWeek: 0,
    openRequests: 0,
  };
  // Thursday 24 September, 7:00–8:30 PM
  const ok = { date: "2026-09-24", startMinutes: 1140, endMinutes: 1230 };

  it("accepts a well-formed request", () => {
    expect(validateRequest(ok, base)).toBeNull();
  });

  it("refuses a date in the past", () => {
    expect(validateRequest({ ...ok, date: "2026-09-17" }, base)).toMatch(/already passed/);
  });

  it("refuses more than the cap in one go", () => {
    expect(validateRequest({ ...ok, endMinutes: 1260 }, base)).toMatch(/1.5 hours is the most/);
  });

  it("refuses times off the block grid", () => {
    expect(validateRequest({ ...ok, startMinutes: 1145 }, base)).toMatch(/30-minute boundaries/);
  });

  it("refuses time outside the day's hours", () => {
    expect(validateRequest({ ...ok, startMinutes: 840, endMinutes: 900 }, base)).toMatch(
      /takes requests from/,
    );
  });

  it("refuses a day the facility does not take requests", () => {
    expect(validateRequest(ok, { ...base, hours: { ...thursday, isOpen: false } })).toMatch(
      /isn't open to requests/,
    );
  });

  it("refuses a closure date and says why", () => {
    const closures = [{ startDate: ok.date, endDate: ok.date, reason: "Floor work" }];
    expect(validateRequest(ok, { ...base, closures })).toMatch(/closed that day — Floor work/);
  });

  it("refuses time another team already holds", () => {
    const taken = [{ startMinutes: 1170, endMinutes: 1200 }];
    expect(validateRequest(ok, { ...base, taken })).toMatch(/already has that time/);
  });

  it("allows a block that starts exactly when another ends", () => {
    const taken = [{ startMinutes: 1050, endMinutes: 1140 }];
    expect(validateRequest(ok, { ...base, taken })).toBeNull();
  });

  it("enforces the notice period", () => {
    // 9:00 AM today, asking for 3:00 PM today — six hours' notice
    const soon = { date: "2026-09-18", startMinutes: 900, endMinutes: 990 };
    expect(validateRequest(soon, base)).toMatch(/24 hours' notice/);
  });

  it("counts notice across the day boundary", () => {
    // 9:00 AM Friday for 3:00 PM Saturday is 30 hours — fine
    const tomorrow = { date: "2026-09-19", startMinutes: 900, endMinutes: 990 };
    expect(validateRequest(tomorrow, { ...base, hours: { ...thursday, weekday: 6 } })).toBeNull();
  });

  it("refuses beyond the booking horizon", () => {
    expect(validateRequest({ ...ok, date: "2026-12-31" }, base)).toMatch(/4 weeks ahead/);
  });

  it("refuses once the team has too many waiting", () => {
    expect(validateRequest(ok, { ...base, openRequests: 2 })).toMatch(/waiting on a decision/);
  });

  it("refuses once the team has its week's worth", () => {
    expect(validateRequest(ok, { ...base, approvedThisWeek: 3 })).toMatch(/3 bookings that week/);
  });
});

describe("countsTowardWeeklyLimit", () => {
  it("counts approved requests", () => {
    expect(countsTowardWeeklyLimit({ status: "HELD", origin: "REQUEST" })).toBe(true);
  });

  it("does not count assigned time or picked-up time", () => {
    // Assigned time is the club's own allocation, and a picked-up block is time
    // nobody else wanted — neither should eat a team's request allowance.
    expect(countsTowardWeeklyLimit({ status: "HELD", origin: "ASSIGNED" })).toBe(false);
    expect(countsTowardWeeklyLimit({ status: "HELD", origin: "PICKUP" })).toBe(false);
  });

  it("does not count what is still pending or already declined", () => {
    expect(countsTowardWeeklyLimit({ status: "PENDING", origin: "REQUEST" })).toBe(false);
    expect(countsTowardWeeklyLimit({ status: "DECLINED", origin: "REQUEST" })).toBe(false);
  });
});

describe("dayAgenda", () => {
  // Thursday, open 3:00–9:00 PM.
  const open = thursday;
  const at = (h: number, m = 0) => h * 60 + m;

  it("is one free run when nothing is booked", () => {
    expect(dayAgenda(open, [])).toEqual([
      { kind: "free", startMinutes: at(15), endMinutes: at(21) },
    ]);
  });

  it("merges consecutive free time rather than listing half-hours", () => {
    // 5:00–6:00 PM booked: free 3:00–5:00, then 6:00–9:00. Two rows, not ten.
    const agenda = dayAgenda(open, [{ startMinutes: at(17), endMinutes: at(18) }]);
    expect(agenda).toEqual([
      { kind: "free", startMinutes: at(15), endMinutes: at(17) },
      { kind: "booked", booking: { startMinutes: at(17), endMinutes: at(18) } },
      { kind: "free", startMinutes: at(18), endMinutes: at(21) },
    ]);
  });

  it("reports no gap between back-to-back bookings", () => {
    const agenda = dayAgenda(open, [
      { startMinutes: at(15), endMinutes: at(16) },
      { startMinutes: at(16), endMinutes: at(17) },
    ]);
    expect(agenda.filter((e) => e.kind === "free")).toEqual([
      { kind: "free", startMinutes: at(17), endMinutes: at(21) },
    ]);
  });

  it("orders by start time whatever order it is given", () => {
    const agenda = dayAgenda(open, [
      { startMinutes: at(19), endMinutes: at(20) },
      { startMinutes: at(16), endMinutes: at(17) },
    ]);
    const booked = agenda.filter((e) => e.kind === "booked");
    expect(booked.map((e) => (e.kind === "booked" ? e.booking.startMinutes : 0))).toEqual([
      at(16),
      at(19),
    ]);
  });

  it("still lists assigned time that sits outside the open hours", () => {
    // The club opens the building when it needs to; 8:00 AM is not requestable
    // but it is certainly on the calendar.
    const agenda = dayAgenda(open, [{ startMinutes: at(8), endMinutes: at(9, 30) }]);
    expect(agenda[0]).toEqual({
      kind: "booked",
      booking: { startMinutes: at(8), endMinutes: at(9, 30) },
    });
    // and the whole open window is still free
    expect(agenda[1]).toEqual({ kind: "free", startMinutes: at(15), endMinutes: at(21) });
  });

  it("offers no free time on a day closed to requests, but still shows bookings", () => {
    const closed = { ...open, isOpen: false };
    expect(dayAgenda(closed, [])).toEqual([]);
    expect(dayAgenda(closed, [{ startMinutes: at(10), endMinutes: at(11) }])).toEqual([
      { kind: "booked", booking: { startMinutes: at(10), endMinutes: at(11) } },
    ]);
  });
});
