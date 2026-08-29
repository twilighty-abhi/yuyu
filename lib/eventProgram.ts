export type EventProgramSession = {
  id: string;
  startDateTime: Date;
  endDateTime: Date;
  sortOrder: number;
  delayMinutes: number;
};

/**
 * Planned times remain immutable. Delays are accumulated in chronological
 * programme order so an update is immediately reversible and auditable.
 */
export function effectiveEventProgram<T extends EventProgramSession>(sessions: T[]) {
  let cumulativeDelayMinutes = 0;
  return [...sessions]
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime() || a.sortOrder - b.sortOrder)
    .map((session) => {
      // Existing rows created before the live-delay migration may not expose
      // the new field until their database migration has been applied.
      const delayMinutes = Number.isFinite(session.delayMinutes) ? session.delayMinutes : 0;
      cumulativeDelayMinutes += delayMinutes;
      return {
        ...session,
        delayMinutes,
        cumulativeDelayMinutes,
        effectiveStartDateTime: new Date(session.startDateTime.getTime() + cumulativeDelayMinutes * 60_000),
        effectiveEndDateTime: new Date(session.endDateTime.getTime() + cumulativeDelayMinutes * 60_000),
      };
    });
}
