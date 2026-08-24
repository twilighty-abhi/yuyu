"use client";

import { useMemo, useState, useTransition } from "react";
import type { RsvpStatus } from "@prisma/client";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import DeleteOutlineOutlinedIcon from "@mui/icons-material/DeleteOutlineOutlined";
import HelpOutlineOutlinedIcon from "@mui/icons-material/HelpOutlineOutlined";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import { CopyTicketButton } from "@/components/attendees/CopyTicketButton";
import { deleteRsvp, restoreRsvp } from "@/app/actions/rsvp-admin";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import {
  approveRsvp,
  promoteFromWaitlist,
  rejectRsvp,
} from "@/app/actions/rsvp-lifecycle";
import { useToast } from "@/components/feedback/ToastProvider";
import { useRouter } from "next/navigation";

export type AttendeeRow = {
  id: string;
  status: RsvpStatus;
  createdAt: string;
  guestEmail: string | null;
  guestName?: string | null;
  user: { id: string; name: string | null; email: string | null } | null;
  checkedInAt: string | null;
  ticketUrl: string;
  answers?: { label: string; value: string }[];
  rawAnswers?: Array<{
    fieldId: string;
    valueText?: string | null;
    valueBool?: boolean | null;
    valueNumber?: number | null;
    valueDate?: string | null;
  }>;
};

type FilterKind = "all" | "guests" | "users";
type StatusFilter = "all" | RsvpStatus;

function statusLabel(s: RsvpStatus) {
  switch (s) {
    case "CONFIRMED":
      return "Confirmed";
    case "WAITLISTED":
      return "Waitlisted";
    case "PENDING_APPROVAL":
      return "Pending";
    case "REJECTED":
      return "Rejected";
    default:
      return s;
  }
}

export function AttendeeTable(props: {
  organisationSlug: string;
  eventId?: string;
  eventInstanceId?: string;
  attendees: AttendeeRow[];
  canManage: boolean;
}) {
  const { organisationSlug, eventId, eventInstanceId, attendees, canManage } =
    props;
  const router = useRouter();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKind>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pending, startTransition] = useTransition();
  const [answersOpen, setAnswersOpen] = useState(false);
  const [answersTitle, setAnswersTitle] = useState<string>("");
  const [answersRows, setAnswersRows] = useState<{ label: string; value: string }[]>([]);
  const [deleteConfirmAttendee, setDeleteConfirmAttendee] = useState<AttendeeRow | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return attendees.filter((a) => {
      if (filter === "guests" && a.user) return false;
      if (filter === "users" && !a.user) return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (!q) return true;
      const name = (a.user?.name ?? "").toLowerCase();
      const email = (a.user?.email ?? a.guestEmail ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [attendees, search, filter, statusFilter]);

  function targetPayload() {
    if (eventId) return { eventId };
    if (eventInstanceId) return { eventInstanceId };
    return {};
  }

  if (attendees.length === 0) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography color="text.secondary">No RSVPs yet.</Typography>
      </Paper>
    );
  }

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
        <TextField
          label="Search name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          size="small"
          fullWidth
        />
        <TextField
          label="Type"
          select
          size="small"
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterKind)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="all">All</MenuItem>
          <MenuItem value="guests">Guests only</MenuItem>
          <MenuItem value="users">Signed-in users</MenuItem>
        </TextField>
        <TextField
          label="Status"
          select
          size="small"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="all">All statuses</MenuItem>
          <MenuItem value="CONFIRMED">Confirmed</MenuItem>
          <MenuItem value="WAITLISTED">Waitlisted</MenuItem>
          <MenuItem value="PENDING_APPROVAL">Pending approval</MenuItem>
          <MenuItem value="REJECTED">Rejected</MenuItem>
        </TextField>
      </Stack>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Email</TableCell>
              <TableCell>Answers</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Check-in</TableCell>
              <TableCell>RSVP time</TableCell>
              {canManage ? <TableCell align="center">Ticket</TableCell> : null}
              {canManage ? <TableCell align="right">Actions</TableCell> : null}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canManage ? 8 : 6}>
                  <Typography color="text.secondary" variant="body2">
                    No matches.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((a) => {
                const email = a.user?.email ?? a.guestEmail ?? "—";
                const guestDisplayName =
                  a.guestName?.trim() ||
                  (a.guestEmail ? a.guestEmail.split("@")[0] : "") ||
                  "Guest";
                const name = a.user?.name ?? (a.user ? "—" : guestDisplayName);
                const ts = new Date(a.createdAt).toLocaleString();
                const answerCount = a.answers?.length ?? 0;
                return (
                  <TableRow key={a.id}>
                    <TableCell>{name}</TableCell>
                    <TableCell>{email}</TableCell>
                    <TableCell>
                      {answerCount > 0 ? (
                        <Button
                          size="small"
                          variant="text"
                          startIcon={<HelpOutlineOutlinedIcon fontSize="small" />}
                          onClick={() => {
                            setAnswersTitle(name);
                            setAnswersRows(a.answers ?? []);
                            setAnswersOpen(true);
                          }}
                        >
                          View ({answerCount})
                        </Button>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip label={statusLabel(a.status)} size="small" />
                    </TableCell>
                    <TableCell>
                      {a.checkedInAt ? (
                        <Chip
                          label={new Date(a.checkedInAt).toLocaleTimeString(
                            undefined,
                            { hour: "numeric", minute: "2-digit" },
                          )}
                          size="small"
                          color="success"
                          variant="outlined"
                        />
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{ts}</TableCell>
                    {canManage ? (
                      <TableCell align="center">
                        <CopyTicketButton ticketUrl={a.ticketUrl} />
                      </TableCell>
                    ) : null}
                    {canManage ? (
                      <TableCell align="right">
                        <Stack
                          direction="row"
                          spacing={0.5}
                          useFlexGap
                          sx={{
                            flexWrap: "wrap",
                            justifyContent: "flex-end",
                          }}
                        >
                          {a.status === "PENDING_APPROVAL" ? (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={pending}
                                onClick={() => {
                                  startTransition(async () => {
                                    const res = await approveRsvp({
                                      organisationSlug,
                                      rsvpId: a.id,
                                      ...targetPayload(),
                                    });
                                    if (!res.ok) {
                                      showToast(res.error, "error");
                                      return;
                                    }
                                    showToast("Approved", "success");
                                    router.refresh();
                                  });
                                }}
                              >
                                Approve
                              </Button>
                              <Button
                                size="small"
                                color="warning"
                                variant="outlined"
                                disabled={pending}
                                onClick={() => {
                                  startTransition(async () => {
                                    const res = await rejectRsvp({
                                      organisationSlug,
                                      rsvpId: a.id,
                                      ...targetPayload(),
                                    });
                                    if (!res.ok) {
                                      showToast(res.error, "error");
                                      return;
                                    }
                                    showToast("Rejected", "success");
                                    router.refresh();
                                  });
                                }}
                              >
                                Reject
                              </Button>
                            </>
                          ) : null}
                          {a.status === "WAITLISTED" ? (
                            <>
                              <Button
                                size="small"
                                variant="outlined"
                                disabled={pending}
                                onClick={() => {
                                  startTransition(async () => {
                                    const res = await promoteFromWaitlist({
                                      organisationSlug,
                                      rsvpId: a.id,
                                      ...targetPayload(),
                                    });
                                    if (!res.ok) {
                                      showToast(res.error, "error");
                                      return;
                                    }
                                    showToast("Promoted", "success");
                                    router.refresh();
                                  });
                                }}
                              >
                                Promote
                              </Button>
                              <Button
                                size="small"
                                color="warning"
                                variant="outlined"
                                disabled={pending}
                                onClick={() => {
                                  startTransition(async () => {
                                    const res = await rejectRsvp({
                                      organisationSlug,
                                      rsvpId: a.id,
                                      ...targetPayload(),
                                    });
                                    if (!res.ok) {
                                      showToast(res.error, "error");
                                      return;
                                    }
                                    showToast("Rejected", "success");
                                    router.refresh();
                                  });
                                }}
                              >
                                Reject
                              </Button>
                            </>
                          ) : null}
                          <IconButton
                            aria-label="Remove RSVP"
                            disabled={pending}
                            onClick={() => setDeleteConfirmAttendee(a)}
                          >
                            <DeleteOutlineOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Stack>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={answersOpen} onClose={() => setAnswersOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Answers · {answersTitle}</DialogTitle>
        <DialogContent>
          {answersRows.length === 0 ? (
            <Typography color="text.secondary">No answers.</Typography>
          ) : (
            <Stack spacing={1.5} sx={{ mt: 1 }}>
              {answersRows.map((r) => (
                <Stack key={r.label} spacing={0.25}>
                  <Typography variant="caption" color="text.secondary">
                    {r.label}
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                    {r.value}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAnswersOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <ConfirmationDialog
        open={!!deleteConfirmAttendee}
        title="Remove Attendee"
        message={`Are you sure you want to remove ${
          deleteConfirmAttendee?.user?.name ?? deleteConfirmAttendee?.guestName ?? deleteConfirmAttendee?.guestEmail ?? "this attendee"
        }'s RSVP registration?`}
        confirmLabel="Remove"
        loading={pending}
        onCancel={() => setDeleteConfirmAttendee(null)}
        onConfirm={() => {
          if (!deleteConfirmAttendee) return;
          const targetAttendee = { ...deleteConfirmAttendee };
          setDeleteConfirmAttendee(null);
          startTransition(async () => {
            const res = await deleteRsvp({
              organisationSlug,
              rsvpId: targetAttendee.id,
              ...targetPayload(),
            });
            if (!res.ok) {
              showToast(res.error, "error");
            } else {
              // 10 second undo popup toast!
              showToast(
                "Attendee removed",
                "success",
                {
                  label: "Undo",
                  onClick: () => {
                    startTransition(async () => {
                      const restoreRes = await restoreRsvp({
                        organisationSlug,
                        undoId: res.data!.undoId,
                      });
                      if (restoreRes.ok) {
                        showToast("Attendee restored", "success");
                        router.refresh();
                      } else {
                        showToast(restoreRes.error, "error");
                      }
                    });
                  },
                },
                10000 // 10 seconds duration
              );
              router.refresh();
            }
          });
        }}
      />
    </Stack>
  );
}
