import type { RsvpStatus } from "@prisma/client";
import type { AttendanceState } from "@/lib/attendanceCheck";
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
  /** TEAM events: the registration's team (null when solo; absent elsewhere). */
  team?: { id: string; name: string; isLeader: boolean } | null;
  /** One-off events: the attendance confirmation badge (state null: no badge) and the guest's note. */
  attendance?: { state: AttendanceState | null; note: string | null; respondedAt: string | null };
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
