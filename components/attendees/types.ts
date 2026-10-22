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
  /** Custom check-in lists ("Swag", "Lunch") this guest has been checked into. */
  listCheckIns?: { listName: string; checkedInAt: string }[];
  ticketUrl: string;
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
