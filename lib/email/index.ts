import type { RsvpStatus } from "@prisma/client";

export async function sendRSVPConfirmation(params: {
  to: string;
  eventTitle: string;
  status: RsvpStatus;
}): Promise<void> {
  void params;
}

export async function sendApprovalNotification(params: {
  to: string;
  eventTitle: string;
  approved: boolean;
}): Promise<void> {
  void params;
}

export async function sendReminder(params: {
  to: string;
  eventTitle: string;
  startsAtIso: string;
}): Promise<void> {
  void params;
}
