import { afterEach, describe, expect, it, vi } from "vitest";
import { logPrismaError } from "@/lib/db";

afterEach(() => vi.restoreAllMocks());

describe("Prisma error log", () => {
  it("skips handled unique-constraint violations such as a duplicate registration", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logPrismaError({ message: "\nInvalid `prisma.rSVP.create()` invocation:\n\n\nUnique constraint failed on the fields: (`eventId`,`attendeeKey`)" });
    expect(stderr).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("still logs other errors as one line, outside the console-forwarded ops alerts", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    logPrismaError({ message: "\nInvalid `prisma.event.findMany()` invocation:\n\nCan't reach database server" });
    expect(stderr).toHaveBeenCalledWith("prisma:error Invalid `prisma.event.findMany()` invocation: Can't reach database server\n");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
