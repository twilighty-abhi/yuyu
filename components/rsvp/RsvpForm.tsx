"use client";

import { useState, useTransition } from "react";
import { useSession } from "next-auth/react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Alert from "@mui/material/Alert";
import Typography from "@mui/material/Typography";
import MenuItem from "@mui/material/MenuItem";
import FormControlLabel from "@mui/material/FormControlLabel";
import Checkbox from "@mui/material/Checkbox";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import FormLabel from "@mui/material/FormLabel";
import FormControl from "@mui/material/FormControl";
import Stack from "@mui/material/Stack";
import InputAdornment from "@mui/material/InputAdornment";
import Select from "@mui/material/Select";
import Link from "next/link";
import type { RsvpStatus } from "@prisma/client";
import type { RegistrationFieldDefinition } from "@/components/rsvp/registrationTypes";

const phoneCountries = [
  { id: "IN", label: "India", dial: "+91" },
  { id: "US", label: "United States", dial: "+1" },
  { id: "GB", label: "United Kingdom", dial: "+44" },
  { id: "AU", label: "Australia", dial: "+61" },
] as const;

function getPhoneParts(raw: unknown) {
  const s = typeof raw === "string" ? raw.trim() : "";
  const dial = phoneCountries.find((c) => s.startsWith(c.dial))?.dial ?? "+91";
  const number = s.startsWith(dial) ? s.slice(dial.length) : s;
  return { dial, number: number.replace(/[^\d]/g, "") };
}

function setPhoneValue(
  current: unknown,
  next: { dial?: string; number?: string },
): string {
  const parts = getPhoneParts(current);
  const dial = next.dial ?? parts.dial;
  const number = (next.number ?? parts.number).replace(/[^\d]/g, "");
  return number ? `${dial}${number}` : "";
}

async function postRsvp(body: unknown) {
  const res = await fetch("/api/rsvp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  let data: { ok?: boolean; error?: string; data?: { ticketToken?: string; status?: RsvpStatus } } = {};
  try {
    data = (await res.json()) as {
      ok?: boolean;
      error?: string;
      data?: { ticketToken?: string; status?: RsvpStatus };
    };
  } catch {
    /* empty */
  }
  if (res.status === 429) {
    return {
      ok: false as const,
      error: data.error ?? "Too many requests. Try again later.",
    };
  }
  if (!res.ok) {
    return {
      ok: false as const,
      error: data.error ?? "Could not save your RSVP.",
    };
  }
  if (data.ok) {
    return {
      ok: true as const,
      ticketToken: data.data?.ticketToken ?? "",
      status: data.data?.status ?? null,
    };
  }
  return {
    ok: false as const,
    error: data.error ?? "Could not save your RSVP.",
  };
}

function storageKey(params: {
  orgSlug: string;
  eventSlug?: string;
  eventInstanceId?: string;
}) {
  const suffix = params.eventInstanceId
    ? `i:${params.eventInstanceId}`
    : `e:${params.eventSlug ?? ""}`;
  return `yuyu:rsvp:${params.orgSlug}:${suffix}`;
}

function safeJsonParse<T>(v: string | null): T | null {
  if (!v) return null;
  try {
    return JSON.parse(v) as T;
  } catch {
    return null;
  }
}

export function RsvpForm(props: {
  orgSlug: string;
  eventSlug?: string;
  eventInstanceId?: string;
  registrationFields?: RegistrationFieldDefinition[];
}) {
  const { orgSlug, eventSlug, eventInstanceId, registrationFields } = props;
  const { data: session, status } = useSession();
  const lsKey = storageKey({ orgSlug, eventSlug, eventInstanceId });
  const [guestEmail, setGuestEmail] = useState("");
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [rsvpStatus, setRsvpStatus] = useState<RsvpStatus | null>(null);
  const [ticketToken, setTicketToken] = useState(() => {
    if (typeof window === "undefined") return "";
    const saved = safeJsonParse<{ ticketToken?: string }>(
      window.localStorage.getItem(lsKey),
    );
    return saved?.ticketToken ?? "";
  });
  const [pending, startTransition] = useTransition();

  const fields = registrationFields ?? [];
  const requireName = !session?.user?.name?.trim();

  function setAnswer(key: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
  }

  if (status === "loading") {
    return <Typography color="text.secondary">Loading…</Typography>;
  }

  if (done) {
    const href = ticketToken ? `/ticket/${ticketToken}` : null;
    const ticketDownloadUrl = ticketToken
      ? `/api/ticket/${ticketToken}/download`
      : null;
    const isConfirmed = rsvpStatus === "CONFIRMED";
    return (
      <Alert severity="success">
        <Stack spacing={1} sx={{ alignItems: "flex-start" }}>
          <Typography variant="body2">
            {isConfirmed
              ? "Registration confirmed. Download and save your ticket now — you’ll need it for check-in."
              : "Registration received. We’ll let you know when its status changes."}
          </Typography>
          {isConfirmed && ticketDownloadUrl ? (
            <Button
              component="a"
              href={ticketDownloadUrl}
              download
              variant="contained"
              size="small"
              sx={{ borderRadius: 999 }}
            >
              Download and save ticket
            </Button>
          ) : null}
          {isConfirmed && href ? (
            <Button component={Link} href={href} variant="outlined" size="small" sx={{ borderRadius: 999 }}>
              View ticket
            </Button>
          ) : null}
        </Stack>
      </Alert>
    );
  }

  if (session?.user) {
    return (
      <Box>
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}
        <Stack spacing={2} sx={{ mb: 2 }}>
          <TextField
            name="name"
            label="Name"
            required={requireName}
            fullWidth
            value={name}
            placeholder={session.user.name ?? ""}
            onChange={(e) => setName(e.target.value)}
          />
          {fields.map((f) => {
            switch (f.type) {
              case "TEXT":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  />
                );
              case "EMAIL":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    type="email"
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                    helperText="We’ll validate basic email format."
                  />
                );
              case "PHONE": {
                const parts = getPhoneParts(answers[f.key]);
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    value={parts.number}
                    onChange={(e) =>
                      setAnswer(
                        f.key,
                        setPhoneValue(answers[f.key], { number: e.target.value }),
                      )
                    }
                    inputMode="tel"
                    placeholder="Phone number"
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <Select
                              value={parts.dial}
                              onChange={(e) =>
                                setAnswer(
                                  f.key,
                                  setPhoneValue(answers[f.key], {
                                    dial: String(e.target.value),
                                  }),
                                )
                              }
                              size="small"
                              variant="standard"
                              disableUnderline
                              sx={{
                                minWidth: 70,
                                "& .MuiSelect-select": { pr: 2 },
                              }}
                            >
                              {phoneCountries.map((c) => (
                                <MenuItem key={c.id} value={c.dial}>
                                  {c.dial} {c.id}
                                </MenuItem>
                              ))}
                            </Select>
                          </InputAdornment>
                        ),
                      },
                    }}
                    helperText="Include country code (default +91)."
                  />
                );
              }
              case "TEXTAREA":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    multiline
                    minRows={3}
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  />
                );
              case "NUMBER":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    type="number"
                    value={(answers[f.key] as string | number | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  />
                );
              case "DATE":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    type="date"
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  />
                );
              case "CHECKBOX":
                return (
                  <FormControlLabel
                    key={f.key}
                    control={
                      <Checkbox
                        checked={Boolean(answers[f.key])}
                        onChange={(_, checked) => setAnswer(f.key, checked)}
                      />
                    }
                    label={f.label}
                  />
                );
              case "SELECT":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    select
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  >
                    <MenuItem value="">—</MenuItem>
                    {f.options.map((opt) => (
                      <MenuItem key={opt} value={opt}>
                        {opt}
                      </MenuItem>
                    ))}
                  </TextField>
                );
              case "MULTI_SELECT": {
                const value = Array.isArray(answers[f.key])
                  ? (answers[f.key] as string[])
                  : [];
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    select
                    slotProps={{ select: { multiple: true } }}
                    value={value}
                    onChange={(e) =>
                      setAnswer(
                        f.key,
                        typeof e.target.value === "string"
                          ? e.target.value.split(",")
                          : e.target.value,
                      )
                    }
                  >
                    {f.options.map((opt) => (
                      <MenuItem key={opt} value={opt}>
                        {opt}
                      </MenuItem>
                    ))}
                  </TextField>
                );
              }
              case "RADIO":
                return (
                  <FormControl key={f.key} required={f.required}>
                    <FormLabel>{f.label}</FormLabel>
                    <RadioGroup
                      value={(answers[f.key] as string | undefined) ?? ""}
                      onChange={(e) => setAnswer(f.key, e.target.value)}
                    >
                      {f.options.map((opt) => (
                        <FormControlLabel
                          key={opt}
                          value={opt}
                          control={<Radio />}
                          label={opt}
                        />
                      ))}
                    </RadioGroup>
                  </FormControl>
                );
              default:
                return null;
            }
          })}
        </Stack>
        <Button
          variant="contained"
          size="large"
          disabled={pending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const res = await postRsvp({
                orgSlug,
                ...(eventInstanceId
                  ? { eventInstanceId }
                  : { eventSlug: eventSlug! }),
                name,
                answers,
              });
              if (!res.ok) setError(res.error);
              else {
                setTicketToken(res.ticketToken ?? "");
                setRsvpStatus(res.status);
                if (typeof window !== "undefined" && res.ticketToken) {
                  window.localStorage.setItem(
                    lsKey,
                    JSON.stringify({
                      ticketToken: res.ticketToken,
                      registeredAt: new Date().toISOString(),
                    }),
                  );
                }
                setDone(true);
              }
            });
          }}
        >
          Register
        </Button>
      </Box>
    );
  }

  return (
    <Box
      component="form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await postRsvp({
            orgSlug,
            ...(eventInstanceId
              ? { eventInstanceId }
              : { eventSlug: eventSlug! }),
            guestEmail,
            name,
            answers,
          });
          if (!res.ok) setError(res.error);
          else {
            setTicketToken(res.ticketToken ?? "");
            setRsvpStatus(res.status);
            if (typeof window !== "undefined" && res.ticketToken) {
              window.localStorage.setItem(
                lsKey,
                JSON.stringify({
                  ticketToken: res.ticketToken,
                  registeredAt: new Date().toISOString(),
                }),
              );
            }
            setDone(true);
          }
        });
      }}
    >
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Register with your email
      </Typography>
      <TextField
        name="name"
        label="Name"
        required
        fullWidth
        value={name}
        onChange={(e) => setName(e.target.value)}
        sx={{ mb: 2 }}
      />
      <TextField
        name="guestEmail"
        label="Email"
        type="email"
        required
        fullWidth
        value={guestEmail}
        onChange={(e) => setGuestEmail(e.target.value)}
        sx={{ mb: 2 }}
      />
      {fields.length > 0 ? (
        <Stack spacing={2} sx={{ mb: 2 }}>
          {fields.map((f) => {
            switch (f.type) {
              case "TEXT":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  />
                );
              case "EMAIL":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    type="email"
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                    helperText="We’ll validate basic email format."
                  />
                );
              case "PHONE": {
                const parts = getPhoneParts(answers[f.key]);
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    value={parts.number}
                    onChange={(e) =>
                      setAnswer(
                        f.key,
                        setPhoneValue(answers[f.key], { number: e.target.value }),
                      )
                    }
                    inputMode="tel"
                    placeholder="Phone number"
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <Select
                              value={parts.dial}
                              onChange={(e) =>
                                setAnswer(
                                  f.key,
                                  setPhoneValue(answers[f.key], {
                                    dial: String(e.target.value),
                                  }),
                                )
                              }
                              size="small"
                              variant="standard"
                              disableUnderline
                              sx={{
                                minWidth: 70,
                                "& .MuiSelect-select": { pr: 2 },
                              }}
                            >
                              {phoneCountries.map((c) => (
                                <MenuItem key={c.id} value={c.dial}>
                                  {c.dial} {c.id}
                                </MenuItem>
                              ))}
                            </Select>
                          </InputAdornment>
                        ),
                      },
                    }}
                    helperText="Include country code (default +91)."
                  />
                );
              }
              case "TEXTAREA":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    multiline
                    minRows={3}
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  />
                );
              case "NUMBER":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    type="number"
                    value={(answers[f.key] as string | number | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  />
                );
              case "DATE":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    type="date"
                    slotProps={{ inputLabel: { shrink: true } }}
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  />
                );
              case "CHECKBOX":
                return (
                  <FormControlLabel
                    key={f.key}
                    control={
                      <Checkbox
                        checked={Boolean(answers[f.key])}
                        onChange={(_, checked) => setAnswer(f.key, checked)}
                      />
                    }
                    label={f.label}
                  />
                );
              case "SELECT":
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    select
                    value={(answers[f.key] as string | undefined) ?? ""}
                    onChange={(e) => setAnswer(f.key, e.target.value)}
                  >
                    <MenuItem value="">—</MenuItem>
                    {f.options.map((opt) => (
                      <MenuItem key={opt} value={opt}>
                        {opt}
                      </MenuItem>
                    ))}
                  </TextField>
                );
              case "MULTI_SELECT": {
                const value = Array.isArray(answers[f.key])
                  ? (answers[f.key] as string[])
                  : [];
                return (
                  <TextField
                    key={f.key}
                    label={f.label}
                    required={f.required}
                    fullWidth
                    select
                    slotProps={{ select: { multiple: true } }}
                    value={value}
                    onChange={(e) =>
                      setAnswer(
                        f.key,
                        typeof e.target.value === "string"
                          ? e.target.value.split(",")
                          : e.target.value,
                      )
                    }
                  >
                    {f.options.map((opt) => (
                      <MenuItem key={opt} value={opt}>
                        {opt}
                      </MenuItem>
                    ))}
                  </TextField>
                );
              }
              case "RADIO":
                return (
                  <FormControl key={f.key} required={f.required}>
                    <FormLabel>{f.label}</FormLabel>
                    <RadioGroup
                      value={(answers[f.key] as string | undefined) ?? ""}
                      onChange={(e) => setAnswer(f.key, e.target.value)}
                    >
                      {f.options.map((opt) => (
                        <FormControlLabel
                          key={opt}
                          value={opt}
                          control={<Radio />}
                          label={opt}
                        />
                      ))}
                    </RadioGroup>
                  </FormControl>
                );
              default:
                return null;
            }
          })}
        </Stack>
      ) : null}
      <Button variant="contained" size="large" disabled={pending} type="submit">
        Register
      </Button>
    </Box>
  );
}
