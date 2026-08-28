import type { Metadata } from "next";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms for using a Yuyu event-management deployment.",
};

const sections = [
  {
    title: "Acceptance and scope",
    body: "By creating an account, joining an organisation, registering for an event, or otherwise using this Yuyu instance, you agree to these Terms of Use. The organisation operating this instance may publish additional terms that apply to its events or community. Where those terms conflict with these terms, the operator's additional terms apply to the extent permitted by law.",
  },
  {
    title: "Accounts and access",
    body: "Keep your account credentials confidential and notify the operator if you believe your account has been used without permission. You are responsible for activity carried out through your account. The operator may suspend or restrict access to protect the service, users, or the integrity of an event.",
  },
  {
    title: "Event organisers",
    body: "Organisation owners and administrators are responsible for the events, invitations, registration forms, attendee communications, and content they create. They must obtain any required permissions or notices for the personal information they collect and must not use the service to process unlawful, misleading, infringing, or harmful content.",
  },
  {
    title: "Acceptable use",
    body: "Do not attempt to bypass security controls, access another organisation's data, send unsolicited or abusive communications, introduce malware, interfere with the service, or use the service in violation of applicable law or another person's rights. Ticket links, invitation links, password-reset links, and similar access links are personal capabilities and must not be shared or misused.",
  },
  {
    title: "Content and data",
    body: "You retain responsibility for the content and data you submit. You grant the operator the limited permission needed to host, process, display, and transmit that content solely to operate the service and the events you participate in. The operator may remove content or restrict access where reasonably necessary to protect the service or comply with law.",
  },
  {
    title: "Availability and third-party services",
    body: "Yuyu is provided on an as-available basis. The operator may change, maintain, or discontinue features and may rely on third-party infrastructure such as hosting, email, or storage providers. The operator should give reasonable notice of material planned changes where practical, but cannot guarantee uninterrupted or error-free operation.",
  },
  {
    title: "Disclaimers and liability",
    body: "To the maximum extent permitted by applicable law, the service is provided without warranties of merchantability, fitness for a particular purpose, or non-infringement. The operator's liability is limited as permitted by applicable law. Nothing in these terms excludes liability that cannot legally be excluded or limited.",
  },
  {
    title: "Termination and changes",
    body: "You may stop using the service at any time. The operator may suspend or terminate access for a breach of these terms, to meet a legal obligation, or to protect users and the service. The operator may update these terms from time to time; continued use after the updated terms take effect means you accept them where permitted by law.",
  },
  {
    title: "Questions and governing terms",
    body: "For questions about an event, account, these terms, or the privacy policy, contact the organisation that operates this instance using its published contact details. The operator must add its legal entity name, contact information, governing law, and dispute process where required for its deployment.",
  },
];

export default function TermsPage() {
  return (
    <Stack spacing={3} sx={{ maxWidth: 820, mx: "auto", py: { xs: 3, sm: 6 } }}>
      <Stack spacing={1} sx={{ textAlign: "center", alignItems: "center" }}>
        <Typography variant="overline" color="primary" sx={{ fontWeight: 700, letterSpacing: "0.12em" }}>
          Yuyu legal
        </Typography>
        <Typography variant="h3" component="h1" sx={{ fontWeight: 750, letterSpacing: "-0.04em" }}>
          Terms of Use
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Last updated August 28, 2026
        </Typography>
      </Stack>

      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 }, borderRadius: 4 }}>
        <Stack spacing={3}>
          <Typography color="text.secondary">
            These terms are a general starting point for a self-hosted Yuyu deployment. They are not legal advice and should be reviewed by the operator&apos;s legal counsel before relying on them in a particular jurisdiction.
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
