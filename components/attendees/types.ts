import type { RsvpStatus } from "@prisma/client";
import type { ManualRsvpField } from "@/components/attendees/ManualRsvpDialog";

/** One registration as the dashboard guest list and its dialogs receive it. */
export type AttendeeRow = {
  id: string;
  status: RsvpStatus;
  createdAt: string;
  guestEmail: string | null;
  guestName?: string | null;
  user: { id: string; name: string | null; email: string | null } | null;
  checkedInAt: string | null;
  ticketUrl: string;
  /** TEAM events: the registration's team (null when solo; absent elsewhere). */
  team?: { id: string; name: string; isLeader: boolean } | null;
  answers?: { label: string; value: string }[];
  rawAnswers?: Array<{
    fieldId: string;
    valueText?: string | null;
    valueBool?: boolean | null;
    valueNumber?: number | null;
    valueDate?: string | null;
  }>;
  registrationFields?: ManualRsvpField[];
};
