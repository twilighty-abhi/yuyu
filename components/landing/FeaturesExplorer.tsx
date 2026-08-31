"use client";

import { useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import ApiOutlinedIcon from "@mui/icons-material/ApiOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import CalendarMonthOutlinedIcon from "@mui/icons-material/CalendarMonthOutlined";
import CelebrationOutlinedIcon from "@mui/icons-material/CelebrationOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import ManageAccountsOutlinedIcon from "@mui/icons-material/ManageAccountsOutlined";
import SettingsSuggestOutlinedIcon from "@mui/icons-material/SettingsSuggestOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";

const featureGroups = [
  {
    id: "events",
    title: "Events & registration",
    summary: "Build exactly the event experience you need, from a simple public RSVP to an approval-only gathering.",
    icon: CelebrationOutlinedIcon,
    features: [
      "Draft, published, and hidden event states with a controlled publishing workflow.",
      "Event details for dates, timezone, location, online attendance, tags, capacity, descriptions, and safe cover images.",
      "Public, hidden-link, approval-required, and invite-only privacy modes.",
      "Configurable visibility for confirmed registration counts.",
      "Cloning, slug updates, deletion, and private email allowlists.",
      "Custom RSVP forms with text, textarea, email, phone, select, multiselect, radio, checkbox, number, and date fields.",
      "Guest and signed-in registration with server-side validation and duplicate-RSVP protection.",
    ],
  },
  {
    id: "series",
    title: "Recurring series & scheduling",
    summary: "Run repeat events without rebuilding the experience every time.",
    icon: CalendarMonthOutlinedIcon,
    features: [
      "RRULE-based recurring event series with timezone-aware schedules.",
      "Materialized instances, each with its own RSVP list and attendance state.",
      "Series-level capacity, privacy, status, and invite management.",
      "Event programme sessions, tracks, rooms, speakers, resources, and cascading live schedule delays.",
      "Public programme, session, and speaker pages for released event websites.",
    ],
  },
  {
    id: "rsvp",
    title: "RSVP lifecycle & invitations",
    summary: "Keep every registration state clear for attendees and organisers.",
    icon: FactCheckOutlinedIcon,
    features: [
      "Capacity-aware confirmation, waiting lists, pending approval, approval, rejection, and cancellation.",
      "Automatic waitlist promotion after a cancellation, plus organiser override flows where supported.",
      "Short-lived server-owned RSVP undo snapshots for safe corrections.",
      "Transactional confirmation and lifecycle email through a durable retrying outbox.",
      "Event, series, collaborator, and organisation invitations with revocable/expiring links.",
      "Attendee management, CSV/email export, and manual registrations for event staff.",
    ],
  },
  {
    id: "checkin",
    title: "Tickets & door check-in",
    summary: "Move the queue quickly while keeping check-in secure and recoverable.",
    icon: BadgeOutlinedIcon,
    features: [
      "Opaque attendee ticket and check-in capabilities with QR and manual-entry flows.",
      "Printable and downloadable attendee tickets for eligible confirmed guests.",
      "Camera scanning, attendee lookup, direct check-in, undo, and a PIN-protected venue station.",
      "Offline roster download, offline check-in queueing, and later synchronization from the dashboard.",
      "Immutable online and offline check-in event history.",
      "Browser-printable ID cards with event branding, attendee fields, and a scannable check-in QR code.",
    ],
  },
  {
    id: "feedback",
    title: "Feedback & certificates",
    summary: "Close the loop after the event without compromising respondent privacy.",
    icon: CelebrationOutlinedIcon,
    features: [
      "Per-event feedback forms with custom questions, title, thank-you message, and open/closed controls.",
      "Anonymous feedback mode with no RSVP identity collection and repeat responses allowed.",
      "Certificate-enabled feedback that verifies a confirmed RSVP before issuing a credential.",
      "Downloadable JPEG certificates delivered through an opaque one-time capability.",
    ],
  },
  {
    id: "public",
    title: "Public pages & discovery",
    summary: "Give every event a polished public presence that people can actually find.",
    icon: LanguageOutlinedIcon,
    features: [
      "Landing, organisation, event, recurring-instance, and event-website pages.",
      "Event website content for highlights, speakers, sponsors, resources, FAQs, and programme sessions.",
      "Public discovery with bounded pagination and search by event title, tag, or organisation.",
      "Sitemap, metadata, Open Graph coverage, and crawler controls that keep sensitive routes out of indexes.",
      "Private application-controlled delivery for processed event cover images and assets.",
    ],
  },
  {
    id: "teams",
    title: "Accounts & teams",
    summary: "Let organisations collaborate without crossing tenant boundaries.",
    icon: ManageAccountsOutlinedIcon,
    features: [
      "Multiple organisations per account with owner, admin, and member roles.",
      "Organisation profiles, logos, slugs, member changes, removals, and protected ownership rules.",
      "Email/password accounts, verified email ownership, optional Google sign-in, and password reset.",
      "Authenticator-app MFA, recovery codes, account profile controls, and revoke-all-sessions protection.",
      "JWT session-version invalidation following sensitive account actions.",
    ],
  },
  {
    id: "security",
    title: "Security & operations",
    summary: "Production-minded controls for teams that care about privacy and reliable delivery.",
    icon: LockOutlinedIcon,
    features: [
      "Strict organisation tenant isolation and server-side role/permission enforcement.",
      "Private S3-compatible storage with cover-image validation, metadata stripping, and WebP re-encoding.",
      "Append-only application audit events plus database-triggered fallback audit records.",
      "Super-admin TOTP step-up, searchable operations/audit views, encrypted write-only service settings, and account-creation controls.",
      "Protected readiness checks, outbox retries, retention cleanup, scheduler heartbeat monitoring, and safe failed-email diagnostics.",
    ],
  },
  {
    id: "api",
    title: "Machine API",
    summary: "Integrate safely without turning credentials into user accounts.",
    icon: ApiOutlinedIcon,
    features: [
      "Tenant-bound API clients with explicit scopes, expiry, rotation, revocation, and disablement.",
      "One-time bearer credentials that are never stored or shown again after creation.",
      "Versioned endpoints for event metadata and minimal confirmed-participant rosters.",
      "Separate attendance and check-in timestamp scopes with deliberately limited DTOs.",
    ],
  },
] as const;

const cardPalettes = [
  { light: "linear-gradient(145deg, #D8F7E7 0%, #F4FFF9 100%)", icon: "#137A55" },
  { light: "linear-gradient(145deg, #E7E0FF 0%, #FAF8FF 100%)", icon: "#6651C8" },
  { light: "linear-gradient(145deg, #FFE2D0 0%, #FFF8F3 100%)", icon: "#C85C35" },
  { light: "linear-gradient(145deg, #DCEEFF 0%, #F5FBFF 100%)", icon: "#286DB3" },
] as const;

export function FeaturesExplorer() {
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set(featureGroups.map((group) => group.id)));
  const prefersReducedMotion = useReducedMotion();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const featureCount = featureGroups.reduce((total, group) => total + group.features.length, 0);
  const allExpanded = expandedGroupIds.size === featureGroups.length;
  const strongInk = isDark ? "text.primary" : "#15243A";

  const toggleGroup = (groupId: string) => {
    setExpandedGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  return (
    <Box sx={{ pb: { xs: 6, md: 10 }, maxWidth: 1120, mx: "auto" }}>
      <Paper variant="outlined" sx={{ position: "relative", overflow: "hidden", p: { xs: 3, sm: 5, md: 7 }, borderRadius: 5, background: isDark ? "radial-gradient(circle at 85% 10%, rgba(185,174,255,0.24), transparent 32%), radial-gradient(circle at 8% 90%, rgba(124,245,182,0.18), transparent 38%), linear-gradient(135deg, rgba(10,132,255,0.13), rgba(12,16,22,0.3))" : "radial-gradient(circle at 86% 10%, rgba(140,110,255,0.4), transparent 34%), radial-gradient(circle at 8% 92%, rgba(30,190,116,0.32), transparent 42%), linear-gradient(135deg, #DDF9EB 0%, #E5E0FF 54%, #FFE1D0 100%)", borderColor: isDark ? "divider" : "rgba(90,112,148,0.18)", boxShadow: isDark ? "none" : "0 28px 80px rgba(63,85,120,0.16)" }}>
        <Box aria-hidden sx={{ position: "absolute", width: 340, height: 340, right: -140, top: -180, borderRadius: "50%", border: "1px dashed", borderColor: isDark ? "rgba(185,174,255,0.25)" : "rgba(101,81,199,0.22)" }} />
        <Box aria-hidden sx={{ position: "absolute", width: 180, height: 180, left: -80, bottom: -100, borderRadius: "50%", bgcolor: isDark ? "rgba(124,245,182,0.07)" : "rgba(255,255,255,0.45)" }} />
        <Stack spacing={2.5} sx={{ position: "relative", alignItems: { xs: "flex-start", md: "center" }, textAlign: { xs: "left", md: "center" } }}>
          <Chip label="YUYU FEATURE GUIDE" variant="outlined" sx={{ color: isDark ? "#B9AEFF" : "#5B49B5", bgcolor: isDark ? "rgba(185,174,255,0.06)" : "rgba(255,255,255,0.48)", borderColor: isDark ? "rgba(185,174,255,0.25)" : "rgba(91,73,181,0.22)", fontWeight: 800, letterSpacing: "0.08em" }} />
          <Typography component="h1" variant="h2" sx={{ color: strongInk, maxWidth: 800, fontSize: { xs: "2.5rem", sm: "3.5rem", md: "4.25rem" }, lineHeight: 1.02, fontWeight: 850, letterSpacing: "-0.065em" }}>Everything you need to run <Box component="span" sx={{ background: isDark ? "linear-gradient(120deg, #7CF5B6, #B9AEFF)" : "linear-gradient(120deg, #087A5A, #6551C7 58%, #C45532)", backgroundClip: "text", WebkitBackgroundClip: "text", color: "transparent" }}>great free events.</Box></Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 680, fontSize: { xs: "1rem", md: "1.1rem" }, lineHeight: 1.65 }}>From the first RSVP to a post-event certificate, Yuyu gives organisations a secure, self-hosted workspace for the full event lifecycle.</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ width: { xs: "100%", sm: "auto" } }}>
            <Button component={Link} href="/login" variant="contained" size="large" endIcon={<ArrowForwardIcon />}>Start hosting free</Button>
            <Button component={Link} href="/discover" variant="outlined" size="large">Explore public events</Button>
          </Stack>
        </Stack>
      </Paper>

      <Stack spacing={2.5} sx={{ mt: { xs: 5, md: 8 }, mb: 4 }}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} sx={{ justifyContent: "space-between", alignItems: { sm: "flex-end" } }}>
          <Stack spacing={0.75}>
            <Typography variant="overline" sx={{ color: isDark ? "#7CF5B6" : "#087A5A", fontWeight: 800, letterSpacing: "0.1em" }}>THE COMPLETE TOOLKIT</Typography>
            <Typography variant="h4" sx={{ color: strongInk, fontWeight: 850, letterSpacing: "-0.04em" }}>Every capability, clearly laid out</Typography>
            <Typography variant="body2" color="text.secondary">{featureGroups.length} feature areas · {featureCount} capabilities. Open or collapse a category whenever you want.</Typography>
          </Stack>
          <Button onClick={() => setExpandedGroupIds(allExpanded ? new Set() : new Set(featureGroups.map((group) => group.id)))} variant="outlined" endIcon={<ExpandMoreOutlinedIcon sx={{ transform: allExpanded ? "rotate(180deg)" : undefined, transition: "transform 0.2s ease" }} />} sx={{ alignSelf: { xs: "flex-start", sm: "auto" } }}>
            {allExpanded ? "Collapse all" : "Show all details"}
          </Button>
        </Stack>
      </Stack>

      <Grid container spacing={2.5}>
          {featureGroups.map((group, index) => {
            const Icon = group.icon;
            const expanded = expandedGroupIds.has(group.id);
            const palette = cardPalettes[index % cardPalettes.length];
            return (
              <Grid key={group.id} size={{ xs: 12, md: 6 }}>
                <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: prefersReducedMotion ? 0 : 0.28, delay: prefersReducedMotion ? 0 : index * 0.035 }}>
                  <Paper variant="outlined" sx={{ height: "100%", p: { xs: 2.5, sm: 3.5 }, borderRadius: 4, background: isDark ? "linear-gradient(145deg, rgba(255,255,255,0.04), rgba(255,255,255,0.012))" : palette.light, borderColor: isDark ? "divider" : "rgba(75,92,118,0.14)", boxShadow: isDark ? "none" : "0 12px 34px rgba(53,70,99,0.07)", transition: "transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease", "&:hover": { transform: "translateY(-4px)", borderColor: isDark ? "primary.main" : palette.icon, boxShadow: isDark ? "0 16px 38px rgba(0,0,0,0.2)" : "0 20px 44px rgba(53,70,99,0.13)" } }}>
                    <Stack spacing={2}>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start" }}>
                        <Box sx={{ flex: "0 0 auto", width: 48, height: 48, display: "grid", placeItems: "center", borderRadius: 2.5, bgcolor: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.7)", color: isDark ? "primary.main" : palette.icon, border: "1px solid", borderColor: isDark ? "divider" : "rgba(255,255,255,0.88)" }}><Icon /></Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="h6" sx={{ color: strongInk, fontWeight: 850 }}>{group.title}</Typography>
                          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35, lineHeight: 1.55 }}>{group.summary}</Typography>
                        </Box>
                      </Stack>
                      <Button onClick={() => toggleGroup(group.id)} aria-expanded={expanded} aria-controls={`feature-details-${group.id}`} variant="text" endIcon={<ExpandMoreOutlinedIcon sx={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform 0.2s ease" }} />} sx={{ alignSelf: "flex-start", px: 0.5, color: isDark ? "primary.main" : palette.icon }}>
                        {expanded ? "Hide details" : `Show ${group.features.length} features`}
                      </Button>
                      <AnimatePresence initial={false}>
                        {expanded ? <motion.div id={`feature-details-${group.id}`} initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={prefersReducedMotion ? undefined : { height: 0, opacity: 0 }} transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: "easeOut" }} style={{ overflow: "hidden" }}><Stack component="ul" spacing={1.1} sx={{ m: 0, pl: 2.5 }}>{group.features.map((feature) => <Typography component="li" key={feature} variant="body2" sx={{ pl: 0.25, lineHeight: 1.55, "&::marker": { color: isDark ? "primary.main" : palette.icon } }}>{feature}</Typography>)}</Stack></motion.div> : null}
                      </AnimatePresence>
                    </Stack>
                  </Paper>
                </motion.div>
              </Grid>
            );
          })}
        </Grid>

      <Paper variant="outlined" sx={{ mt: { xs: 5, md: 8 }, position: "relative", overflow: "hidden", p: { xs: 3.5, sm: 5 }, borderRadius: 4, textAlign: "center", background: isDark ? "linear-gradient(135deg, rgba(124,245,182,0.1), rgba(185,174,255,0.1))" : "radial-gradient(circle at 50% 0%, rgba(51,196,128,0.3), transparent 62%), linear-gradient(135deg, #DFF3FF, #E8E1FF 56%, #FFE2D1)", borderColor: isDark ? "divider" : "rgba(75,92,118,0.16)", boxShadow: isDark ? "none" : "0 22px 58px rgba(53,70,99,0.12)" }}>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <Box sx={{ width: 56, height: 56, display: "grid", placeItems: "center", borderRadius: 3, bgcolor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.7)", color: isDark ? "primary.main" : "#087A5A" }}><SettingsSuggestOutlinedIcon sx={{ fontSize: 32 }} /></Box>
          <Typography variant="h4" sx={{ color: strongInk, fontWeight: 850 }}>Ready to make your next event easier?</Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 560 }}>Create an organisation, invite your team, and run your event with no ticket sales or payment complexity.</Typography>
          <Button component={Link} href="/login" variant="contained" size="large" endIcon={<ArrowForwardIcon />}>Get started with Yuyu</Button>
        </Stack>
      </Paper>
    </Box>
  );
}
