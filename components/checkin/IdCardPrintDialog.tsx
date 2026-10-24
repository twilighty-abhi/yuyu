"use client";

import { useState } from "react";
import { Description as DialogDescription } from "@radix-ui/react-dialog";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { IdCardDesigner } from "./id-card/IdCardDesigner";
import { QuickPrintSheet } from "./id-card/QuickPrintSheet";
import type { IdCardAttendee, RegistrationField } from "./id-card/shared";

/**
 * Badge printing at the check-in desk. With an attendee it opens the quick
 * print sheet (their badge plus one Print button); without one, or after
 * "Edit design", it opens the full designer.
 */
export function IdCardPrintDialog(props: {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventTitle: string;
  organisationName: string;
  organisationLogoUrl: string | null;
  attendee: IdCardAttendee | null;
  registrationFields: RegistrationField[];
  /** TEAM event: the designer offers the Team line and the {{team}} merge field. */
  teamEvent?: boolean;
}) {
  const { open, onClose, attendee } = props;
  const [designing, setDesigning] = useState(false);
  // Reset to the quick sheet whenever the dialog opens for someone new.
  // (The check-in page passes a fresh object each render, so compare the ticket.)
  const attendeeKey = attendee?.checkInQrToken ?? null;
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (open && attendeeKey !== openedFor) {
    setOpenedFor(attendeeKey);
    setDesigning(false);
  }
  const showDesigner = !attendee || designing;
  const close = () => {
    setDesigning(false);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent
        size={showDesigner ? "xl" : "md"}
        hideClose={showDesigner}
        aria-labelledby="id-card-designer-title"
        className={showDesigner ? "h-[min(940px,96dvh)] max-h-[96dvh] w-[calc(100vw-16px)] max-w-330 sm:w-[calc(100vw-32px)]" : undefined}
      >
        <DialogDescription className="sr-only">
          {showDesigner ? "Design the badge printed at check-in." : "Print this attendee's badge."}
        </DialogDescription>
        {showDesigner ? (
          <IdCardDesigner
            eventId={props.eventId}
            eventTitle={props.eventTitle}
            organisationName={props.organisationName}
            organisationLogoUrl={props.organisationLogoUrl}
            attendee={attendee}
            registrationFields={props.registrationFields}
            teamEvent={props.teamEvent}
            onClose={attendee ? () => setDesigning(false) : close}
          />
        ) : attendee ? (
          <QuickPrintSheet
            eventId={props.eventId}
            eventTitle={props.eventTitle}
            organisationName={props.organisationName}
            organisationLogoUrl={props.organisationLogoUrl}
            attendee={attendee}
            onEditDesign={() => setDesigning(true)}
            onClose={close}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
