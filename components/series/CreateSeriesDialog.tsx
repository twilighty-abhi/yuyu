"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EventPrivacyType, EventStatus } from "@prisma/client";
import { Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/display";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { Field, Input, Dropdown, Textarea } from "@/components/ui/field";
import { createEventSeries } from "@/app/actions/series";

const timezones = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Paris",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function CreateSeriesDialog(props: {
  organisationSlug: string;
  canPublish: boolean;
}) {
  const { organisationSlug, canPublish } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button variant="secondary" startIcon={<Repeat />} onClick={() => setOpen(true)}>
        New series
      </Button>
      <Dialog open={open} onOpenChange={(next) => { if (!next && !pending) setOpen(false); }}>
        <DialogContent size="md">
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              const form = e.currentTarget;
              const fd = new FormData(form);
              const capacityRaw = String(fd.get("capacity") ?? "").trim();
              let status: EventStatus = EventStatus.DRAFT;
              if (canPublish) {
                const raw = String(fd.get("status") ?? "");
                if (raw === EventStatus.PUBLISHED) status = EventStatus.PUBLISHED;
              }
              const privacyType = String(
                fd.get("privacyType") ?? EventPrivacyType.PUBLIC,
              ) as EventPrivacyType;

              startTransition(async () => {
                const res = await createEventSeries({
                  organisationSlug,
                  title: String(fd.get("title") ?? ""),
                  description: String(fd.get("description") ?? ""),
                  // Wall-clock values: the server reads them in `timezone`.
                  anchorStartDateTime: String(fd.get("anchorStartDateTime") ?? ""),
                  anchorEndDateTime: String(fd.get("anchorEndDateTime") ?? ""),
                  rruleLine: String(fd.get("rruleLine") ?? ""),
                  timezone: String(fd.get("timezone") ?? "UTC"),
                  capacity: capacityRaw,
                  status,
                  privacyType,
                });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setOpen(false);
                form.reset();
                router.refresh();
                if (res.ok && res.data) {
                  router.push(
                    `/dashboard/${organisationSlug}/series/${res.data.id}`,
                  );
                }
              });
            }}
          >
            <DialogHeader title="Create event series" />
            <DialogBody className="flex flex-col gap-4">
              {error ? <Callout tone="danger" role="alert">{error}</Callout> : null}
              <Field label="Title" required>
                <Input name="title" autoFocus />
              </Field>
              <Field label="Description">
                <Textarea name="description" rows={2} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First occurrence start" required>
                  <Input name="anchorStartDateTime" type="datetime-local" />
                </Field>
                <Field label="First occurrence end" required>
                  <Input name="anchorEndDateTime" type="datetime-local" />
                </Field>
              </div>
              <Field label="Recurrence (RRULE)" required helperText="RFC 5545 RRULE line without the RRULE: prefix.">
                <Input name="rruleLine" placeholder="FREQ=WEEKLY;BYDAY=MO;COUNT=12" className="font-mono text-[15px]" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Timezone" required>
                  <Dropdown name="timezone" defaultValue="UTC">
                    {timezones.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </Dropdown>
                </Field>
                <Field label="Capacity per occurrence" optional>
                  <Input name="capacity" type="number" min={1} inputMode="numeric" />
                </Field>
              </div>
              {canPublish ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Status">
                    <Dropdown name="status" defaultValue={EventStatus.DRAFT}>
                      <option value={EventStatus.DRAFT}>Draft</option>
                      <option value={EventStatus.PUBLISHED}>Published</option>
                    </Dropdown>
                  </Field>
                  <Field label="Audience">
                    <Dropdown name="privacyType" defaultValue={EventPrivacyType.PUBLIC}>
                      <option value={EventPrivacyType.PUBLIC}>Public</option>
                      <option value={EventPrivacyType.HIDDEN_LINK}>Hidden link</option>
                      <option value={EventPrivacyType.APPROVAL_REQUIRED}>Approval required</option>
                      <option value={EventPrivacyType.INVITE_ONLY}>Invite only</option>
                    </Dropdown>
                  </Field>
                </div>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending} loading={pending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
