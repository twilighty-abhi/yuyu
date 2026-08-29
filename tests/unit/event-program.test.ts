import { describe, expect, it } from "vitest";
import { effectiveEventProgram } from "@/lib/eventProgram";

describe("effectiveEventProgram", () => {
  const session = (id: string, start: string, end: string, sortOrder: number, delayMinutes: number) => ({ id, startDateTime: new Date(start), endDateTime: new Date(end), sortOrder, delayMinutes });

  it("keeps planned times when there are no live delays", () => {
    const [first] = effectiveEventProgram([session("one", "2030-01-01T10:00:00Z", "2030-01-01T11:00:00Z", 1, 0)]);
    expect(first.cumulativeDelayMinutes).toBe(0);
    expect(first.effectiveStartDateTime).toEqual(first.startDateTime);
    expect(first.effectiveEndDateTime).toEqual(first.endDateTime);
  });

  it("treats missing or invalid legacy delay values as no delay", () => {
    const legacy = { ...session("one", "2030-01-01T10:00:00Z", "2030-01-01T11:00:00Z", 1, 0), delayMinutes: Number.NaN };
    const [first] = effectiveEventProgram([legacy]);
    expect(first.cumulativeDelayMinutes).toBe(0);
    expect(first.effectiveStartDateTime.toISOString()).toBe("2030-01-01T10:00:00.000Z");
  });

  it("cascades a delay to the selected session and all following sessions", () => {
    const result = effectiveEventProgram([
      session("one", "2030-01-01T10:00:00Z", "2030-01-01T11:00:00Z", 1, 15),
      session("two", "2030-01-01T11:00:00Z", "2030-01-01T12:00:00Z", 2, 0),
    ]);
    expect(result.map((item) => item.effectiveStartDateTime.toISOString())).toEqual(["2030-01-01T10:15:00.000Z", "2030-01-01T11:15:00.000Z"]);
  });

  it("accumulates multiple delays in stable chronological order", () => {
    const result = effectiveEventProgram([
      session("later", "2030-01-01T11:00:00Z", "2030-01-01T12:00:00Z", 2, 10),
      session("first", "2030-01-01T10:00:00Z", "2030-01-01T11:00:00Z", 1, 5),
      session("same-time", "2030-01-01T11:00:00Z", "2030-01-01T12:00:00Z", 3, 0),
    ]);
    expect(result.map((item) => item.id)).toEqual(["first", "later", "same-time"]);
    expect(result.map((item) => item.cumulativeDelayMinutes)).toEqual([5, 15, 15]);
  });
});
