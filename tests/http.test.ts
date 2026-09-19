import { describe, expect, it } from "vitest";
import { pathWithQuery, redirectTo } from "@/lib/http";

describe("redirectTo", () => {
  it("sends a relative Location, which survives a proxy", () => {
    // The whole point: behind a proxy the app only knows the internal address it
    // was handed (localhost:8080 in production), so an absolute Location built
    // from the request points the browser at a host that does not exist outside
    // the container. A relative one is resolved against the URL the browser used.
    const response = redirectTo("/decide/done?state=approved");
    expect(response.headers.get("location")).toBe("/decide/done?state=approved");
    expect(response.headers.get("location")).not.toMatch(/^https?:/);
    expect(response.status).toBe(307);
  });

  it("can send a 303, so a POST is followed with a GET", () => {
    expect(redirectTo("/signin", 303).status).toBe(303);
  });
});

describe("pathWithQuery", () => {
  it("appends the params it was given", () => {
    expect(pathWithQuery("/decide/done", { state: "approved", b: "abc123" })).toBe(
      "/decide/done?state=approved&b=abc123",
    );
  });

  it("leaves out the ones with no value", () => {
    expect(pathWithQuery("/decide/done", { state: "invalid", b: undefined })).toBe(
      "/decide/done?state=invalid",
    );
    expect(pathWithQuery("/decide/done", { state: "", b: "" })).toBe("/decide/done");
  });

  it("escapes a value rather than letting it change the path", () => {
    expect(pathWithQuery("/decide/done", { state: "a b&c=d" })).toBe(
      "/decide/done?state=a+b%26c%3Dd",
    );
  });
});
