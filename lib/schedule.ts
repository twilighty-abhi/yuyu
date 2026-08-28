export type ScheduleItem = { id: string; title: string; description: string; startDateTime: Date; endDateTime: Date; delayMinutes: number; sortOrder: number };
export function effectiveSchedule(items: ScheduleItem[]) {
  let delay = 0;
  return [...items].sort((a, b) => a.sortOrder - b.sortOrder).map((item) => { delay += item.delayMinutes; return { ...item, effectiveStart: new Date(item.startDateTime.getTime() + delay * 60_000), effectiveEnd: new Date(item.endDateTime.getTime() + delay * 60_000), cumulativeDelayMinutes: delay }; });
}
