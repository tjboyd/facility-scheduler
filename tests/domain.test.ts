import { describe, expect, it } from "vitest";
import {
  canDecideRequests,
  canManagePeople,
  canRequestTime,
  canSignIn,
  displayName,
  isRole,
  isStatus,
  isValidEmail,
  normalizeEmail,
  parseEmailList,
  requiresTeam,
  wouldRemoveLastSuperAdmin,
} from "@/lib/domain";

describe("normalizeEmail", () => {
  it("trims and lowercases so lookups and storage agree", () => {
    expect(normalizeEmail("  Rivera@JrChargersBaseball.com ")).toBe(
      "rivera@jrchargersbaseball.com",
    );
  });
});

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("rivera@jrchargersbaseball.com")).toBe(true);
    expect(isValidEmail("a.b-c+tag@sub.example.co.uk")).toBe(true);
  });

  it("rejects the usual typos", () => {
    for (const bad of ["", "   ", "rivera", "rivera@", "@example.com", "a@b", "a b@c.com", "a@@b.com"]) {
      expect(isValidEmail(bad), bad).toBe(false);
    }
  });

  it("rejects absurdly long input", () => {
    expect(isValidEmail(`${"x".repeat(250)}@example.com`)).toBe(false);
  });
});

describe("parseEmailList", () => {
  it("splits on newlines, commas and semicolons", () => {
    const { valid, invalid } = parseEmailList("a@x.com\nb@x.com, c@x.com; d@x.com");
    expect(valid).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
    expect(invalid).toEqual([]);
  });

  it("unwraps 'Name <addr>' pasted out of a mail client", () => {
    const { valid } = parseEmailList("Coach Rivera <rivera@x.com>\nOkafor  okafor@x.com");
    expect(valid).toEqual(["rivera@x.com", "okafor@x.com"]);
  });

  it("normalizes and de-duplicates, keeping first-seen order", () => {
    const { valid } = parseEmailList("B@x.com\na@x.com\nb@X.COM");
    expect(valid).toEqual(["b@x.com", "a@x.com"]);
  });

  it("reports what it could not read, as typed", () => {
    const { valid, invalid } = parseEmailList("good@x.com\nnot-an-email\n  \nalso bad@");
    expect(valid).toEqual(["good@x.com"]);
    expect(invalid).toEqual(["not-an-email", "also bad@"]);
  });

  it("returns empty for empty input rather than throwing", () => {
    expect(parseEmailList("")).toEqual({ valid: [], invalid: [] });
  });
});

describe("role capabilities", () => {
  it("limits people management to super admins", () => {
    expect(canManagePeople("SUPER_ADMIN")).toBe(true);
    expect(canManagePeople("APPROVER")).toBe(false);
    expect(canManagePeople("HEAD_COACH")).toBe(false);
  });

  it("lets approvers and super admins decide requests", () => {
    expect(canDecideRequests("APPROVER")).toBe(true);
    expect(canDecideRequests("SUPER_ADMIN")).toBe(true);
    expect(canDecideRequests("HEAD_COACH")).toBe(false);
  });

  it("lets everyone on the list request time", () => {
    expect(canRequestTime("HEAD_COACH")).toBe(true);
    expect(canRequestTime("APPROVER")).toBe(true);
    expect(canRequestTime("SUPER_ADMIN")).toBe(true);
  });

  it("requires a team only for head coaches", () => {
    expect(requiresTeam("HEAD_COACH")).toBe(true);
    expect(requiresTeam("APPROVER")).toBe(false);
    expect(requiresTeam("SUPER_ADMIN")).toBe(false);
  });
});

describe("canSignIn", () => {
  it("lets invited and active people in, and keeps disabled people out", () => {
    expect(canSignIn("INVITED")).toBe(true);
    expect(canSignIn("ACTIVE")).toBe(true);
    expect(canSignIn("DISABLED")).toBe(false);
  });
});

describe("wouldRemoveLastSuperAdmin", () => {
  const only = ["admin-1"];
  const two = ["admin-1", "admin-2"];

  it("blocks demoting the only super admin", () => {
    expect(
      wouldRemoveLastSuperAdmin({
        currentSuperAdminIds: only,
        targetId: "admin-1",
        nextRole: "APPROVER",
      }),
    ).toBe(true);
  });

  it("blocks removing the only super admin's access", () => {
    expect(
      wouldRemoveLastSuperAdmin({ currentSuperAdminIds: only, targetId: "admin-1", nextRole: null }),
    ).toBe(true);
  });

  it("allows it once a second super admin exists", () => {
    expect(
      wouldRemoveLastSuperAdmin({ currentSuperAdminIds: two, targetId: "admin-1", nextRole: null }),
    ).toBe(false);
  });

  it("ignores edits that leave the role alone", () => {
    expect(
      wouldRemoveLastSuperAdmin({
        currentSuperAdminIds: only,
        targetId: "admin-1",
        nextRole: "SUPER_ADMIN",
      }),
    ).toBe(false);
  });

  it("ignores people who are not super admins", () => {
    expect(
      wouldRemoveLastSuperAdmin({ currentSuperAdminIds: only, targetId: "coach-9", nextRole: null }),
    ).toBe(false);
  });
});

describe("guards on stored strings", () => {
  it("rejects values that are not roles or statuses", () => {
    expect(isRole("SUPER_ADMIN")).toBe(true);
    expect(isRole("OWNER")).toBe(false);
    expect(isStatus("ACTIVE")).toBe(true);
    expect(isStatus("PENDING")).toBe(false);
  });
});

describe("displayName", () => {
  it("falls back to the address until someone has signed in", () => {
    expect(displayName({ name: "Coach Rivera", email: "r@x.com" })).toBe("Coach Rivera");
    expect(displayName({ name: null, email: "r@x.com" })).toBe("r@x.com");
    expect(displayName({ name: "   ", email: "r@x.com" })).toBe("r@x.com");
  });
});
