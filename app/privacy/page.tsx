import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Yuyu event-management deployments handle personal information.",
};

const sections = [
  {
    title: "Who is responsible for your information",
    body: "Yuyu is self-hosted software. The organisation that operates this Yuyu instance is responsible for its use of personal information and for providing its own contact details, retention rules, and any notices required in its jurisdiction. Each event organiser is responsible for the information it collects from attendees through its events and registration forms.",
  },
  {
    title: "Information the service processes",
    body: "Depending on how you use the service, this may include account details such as your name and email address; organisation and event details; RSVP details such as attendee name, email address, registration answers, ticket and check-in status; and feedback submitted through an event form. The service also processes technical and security information needed to operate accounts, prevent abuse, and maintain an audit trail.",
  },
  {
    title: "How information is used",
    body: "Information is used to provide and secure the event service: to authenticate users, create and manage events, accept and manage registrations, issue tickets, support check-in, send transactional email, and investigate security or operational issues. Event organisers may use attendee information to run their events and communicate with registered attendees. Yuyu does not sell personal information.",
  },
  {
    title: "Sharing and service providers",
    body: "Information is shared only as needed to deliver the service or where required by law. A deployment operator may use infrastructure providers for hosting, private object storage, email delivery, backups, or monitoring. Organisers can access information for events and organisations they are authorised to manage. Public event pages expose only the details the organiser chooses to publish.",
  },
  {
    title: "Security",
    body: "Yuyu is designed with tenant isolation, role-based access controls, private object storage, encrypted secrets, rate limits, and security logging. No system can guarantee absolute security. Deployment operators remain responsible for securely configuring their hosting, databases, email, backups, and access controls.",
  },
  {
    title: "Retention and deletion",
    body: "Retention is determined by the hosting organisation and, where applicable, the relevant event organiser. Some short-lived operational records are automatically cleaned up by the service, but broader retention, backup, and deletion practices are set by the deployment operator. Ask the relevant organiser or instance operator about its retention schedule.",
  },
  {
    title: "Your choices and requests",
    body: "To request access, correction, deletion, or other action concerning your information, contact the organisation that hosted the event or operates this instance. It will assess and handle requests under the laws that apply to it. Account holders can also update basic profile details through their account settings.",
  },
  {
    title: "Changes to this policy",
    body: "The operator may update this policy when the service or its data practices change. The current version is published on this page. Material changes should be communicated by the operator where required by applicable law.",
  },
];

export default function PrivacyPage() {
  return (
    <Stack spacing={3} sx={{ maxWidth: 820, mx: "auto", py: { xs: 3, sm: 6 } }}>
      <Stack spacing={1} sx={{ textAlign: "center", alignItems: "center" }}>
        <Typography variant="overline" color="primary" sx={{ fontWeight: 700, letterSpacing: "0.12em" }}>
          Yuyu legal
        </Typography>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 750, letterSpacing: "-0.04em" }}>
          Privacy Policy
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Last updated August 28, 2026
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 }, borderRadius: 4 }}>
        <Stack spacing={3}>
          <Typography color="text.secondary">
            This policy explains the privacy practices built into Yuyu. It is a general product notice and must be reviewed and supplemented by each deployment operator for its legal jurisdiction, contact details, and actual hosting arrangements.
          </Typography>
          {sections.map((section, index) => (
            <Box key={section.title}>
              {index > 0 ? <Divider sx={{ mb: 3 }} /> : null}
              <Typography variant="h6" component="h2" sx={{ mb: 1, fontWeight: 700 }}>
                {section.title}
              </Typography>
              <Typography color="text.secondary">{section.body}</Typography>
            </Box>
          ))}
        </Stack>
      </Paper>
    </Stack>
  );
}
