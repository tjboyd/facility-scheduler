import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmail, type EmailSpec } from "@/lib/email";

const spec: EmailSpec = {
  eyebrow: "Time request",
  title: "U9 - White — Sat, Sep 26",
  preheader: "Tom Boyd asked for Saturday morning.",
  blocks: [
    { kind: "text", text: "Tom Boyd asked for facility time." },
    {
      kind: "facts",
      facts: [
        { label: "Team", value: "U9 - White" },
        { label: "When", value: "Sat, Sep 26 · 11:00 AM – 12:30 PM" },
      ],
    },
    { kind: "quote", text: "Makeup practice before the tournament." },
    { kind: "button", label: "Approve this request", url: "https://example.org/decide?token=abc&x=1" },
    { kind: "link", label: "Or decline it", url: "https://example.org/approvals" },
  ],
  footer: ["You get this because you can approve requests."],
};

describe("renderEmail", () => {
  const { html, text } = renderEmail(spec);

  it("puts every link in both bodies, so neither is a dead end", () => {
    for (const url of ["https://example.org/decide?token=abc&x=1", "https://example.org/approvals"]) {
      expect(text).toContain(url);
      // The HTML carries it escaped, in an href and as pasteable text.
      expect(html).toContain(escapeHtml(url));
    }
  });

  it("says everything in plain text too", () => {
    expect(text).toContain("Tom Boyd asked for facility time.");
    expect(text).toContain("Team:");
    expect(text).toContain("U9 - White");
    expect(text).toContain('"Makeup practice before the tournament."');
    expect(text).toContain("You get this because you can approve requests.");
  });

  it("carries a preheader, which is what an inbox shows before anyone opens it", () => {
    expect(html).toContain("Tom Boyd asked for Saturday morning.");
  });

  it("holds no stylesheet or web font — email clients drop both", () => {
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("class=");
  });

  it("escapes a value rather than letting it become markup", () => {
    const { html: escaped, text: plain } = renderEmail({
      ...spec,
      blocks: [{ kind: "text", text: '<script>alert("x")</script> & co' }],
    });
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    // Plain text is not markup, so it keeps the characters as typed.
    expect(plain).toContain('<script>alert("x")</script> & co');
  });

  it("never runs three blank lines together", () => {
    expect(text).not.toMatch(/\n{3}/);
  });
});

describe("escapeHtml", () => {
  it("covers the five characters that matter", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});
