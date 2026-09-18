import { describe, expect, it, vi } from "vitest";
import { describePostmarkError, postmarkPayload, type PostmarkConfig } from "@/lib/mail";

const cfg: PostmarkConfig = {
  token: "test-token",
  from: "Jr Chargers Facility <no-reply@mail.example.org>",
  messageStream: "outbound",
};

const mail = { to: "coach@example.org", subject: "Your sign-in link", text: "link here" };

describe("postmarkPayload", () => {
  it("maps onto the fields Postmark expects", () => {
    expect(postmarkPayload(mail, cfg)).toEqual({
      From: "Jr Chargers Facility <no-reply@mail.example.org>",
      To: "coach@example.org",
      Subject: "Your sign-in link",
      TextBody: "link here",
      MessageStream: "outbound",
    });
  });

  it("includes a reply-to only when one is configured", () => {
    expect(postmarkPayload(mail, cfg).ReplyTo).toBeUndefined();
    expect(postmarkPayload(mail, { ...cfg, replyTo: "facility@example.org" }).ReplyTo).toBe(
      "facility@example.org",
    );
  });

  it("keeps sign-in links on a transactional stream", () => {
    // A broadcast stream is filtered far harder — auth mail must not go there.
    expect(postmarkPayload(mail, cfg).MessageStream).toBe("outbound");
  });
});

describe("describePostmarkError", () => {
  it("names a bad token rather than blaming the address", () => {
    const err = describePostmarkError(401, { ErrorCode: 10, Message: "Bad token" });
    expect(err.message).toMatch(/server token/i);
    expect(err.recipientProblem).toBe(false);
  });

  it("flags an invalid address as the recipient's problem", () => {
    const err = describePostmarkError(422, { ErrorCode: 300, Message: "Invalid 'To' address" });
    expect(err.recipientProblem).toBe(true);
  });

  it("explains a suppressed address, which is the confusing one", () => {
    const err = describePostmarkError(422, { ErrorCode: 406, Message: "Inactive recipient" });
    expect(err.recipientProblem).toBe(true);
    expect(err.message).toMatch(/inactive/i);
  });

  it("degrades to the status code when Postmark says nothing useful", () => {
    expect(describePostmarkError(503, null).message).toMatch(/503/);
  });
});

describe("configuration guards", () => {
  it("refuses to pretend it can send when Postmark is not configured", async () => {
    vi.resetModules();
    vi.stubEnv("MAIL_TRANSPORT", "postmark");
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "");
    const { sendMail, MailError } = await import("@/lib/mail");
    await expect(sendMail(mail)).rejects.toBeInstanceOf(MailError);
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("rejects an unknown transport by name", async () => {
    vi.resetModules();
    vi.stubEnv("MAIL_TRANSPORT", "carrier-pigeon");
    const { sendMail } = await import("@/lib/mail");
    await expect(sendMail(mail)).rejects.toThrow(/carrier-pigeon/);
    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
