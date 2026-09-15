import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodemailer from "nodemailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("real Nodemailer composition and access restrictions", () => {
  const transporter = nodemailer.createTransport({
    streamTransport: true, buffer: true, newline: "unix",
    disableFileAccess: true, disableUrlAccess: true,
  });
  const envelope = {
    from: "Yuyu <noreply@example.test>", to: "Attendee <attendee@example.test>",
    subject: "Your event", messageId: "<stable-outbox@example.test>",
  };
  let directory: string;
  let file: string;
  let url: string;
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.end("disposable URL fixture");
  });

  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "yuyu-mail-test-"));
    file = join(directory, "message.txt");
    await writeFile(file, "Subject: fixture\r\n\r\ndisposable file fixture");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test server address");
    url = `http://127.0.0.1:${address.port}/fixture`;
  });

  afterAll(async () => {
    transporter.close();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("composes text, HTML and an inline calendar attachment without SMTP", async () => {
    const calendar = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
    const result = await transporter.sendMail({
      ...envelope, text: "Event details", html: "<p>Event details</p>",
      attachments: [{ filename: "event.ics", content: calendar, contentType: "text/calendar; charset=utf-8; method=PUBLISH" }],
    });
    const message = result.message.toString();
    expect(result.messageId).toBe(envelope.messageId);
    expect(result.envelope).toEqual({ from: "noreply@example.test", to: ["attendee@example.test"] });
    expect(message).toContain("Subject: Your event");
    expect(message).toContain("Message-ID: <stable-outbox@example.test>");
    expect(message).toContain("Content-Type: text/plain");
    expect(message).toContain("Content-Type: text/html");
    expect(message).toContain("<p>Event details</p>");
    expect(message).toContain("Content-Type: text/calendar");
    expect(message).toContain('filename=event.ics');
    expect(message.replace(/\r?\n/g, "")).toContain(Buffer.from(calendar).toString("base64"));
  });

  it.each(["attachment", "raw"] as const)("rejects file-backed %s content despite message-level overrides", async kind => {
    const content = kind === "raw" ? { raw: { path: file } } : { attachments: [{ path: file }] };
    await expect(transporter.sendMail({ ...envelope, text: "Safe text", ...content, disableFileAccess: false }))
      .rejects.toThrow(/File access rejected/);
  });

  it.each(["attachment", "raw"] as const)("rejects URL-backed %s content without making a request", async kind => {
    const before = requests;
    const content = kind === "raw" ? { raw: { href: url } } : { attachments: [{ href: url }] };
    await expect(transporter.sendMail({ ...envelope, text: "Safe text", ...content, disableUrlAccess: false }))
      .rejects.toThrow(/Url access rejected/);
    expect(requests).toBe(before);
  });
});
