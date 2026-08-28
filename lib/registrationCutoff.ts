import "server-only";

export function registrationClosesAt(event: {
  startDateTime: Date;
  registrationClosesAt: Date | null;
  registrationLeadMinutes: number | null;
}) {
  if (event.registrationClosesAt) return event.registrationClosesAt;
  if (event.registrationLeadMinutes != null) {
    return new Date(event.startDateTime.getTime() - event.registrationLeadMinutes * 60_000);
  }
  return null;
}

export function isRegistrationClosed(event: {
  startDateTime: Date;
  registrationClosesAt: Date | null;
  registrationLeadMinutes: number | null;
}, now = new Date()) {
  const closesAt = registrationClosesAt(event);
  return closesAt !== null && now >= closesAt;
}
