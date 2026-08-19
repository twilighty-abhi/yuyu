import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import {
  canManageMembers,
  isOrgAdmin,
  requireOrgMembership,
} from "@/lib/permissions";
import { MemberRoleActions } from "@/components/members/MemberRoleActions";
import { OrgInviteLinkPanel } from "@/components/members/OrgInviteLinkPanel";

import type { Metadata } from "next";

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata: Metadata = {
  title: "Members",
  description: "Organisation members and roles.",
};

export default async function OrgMembersPage({ params }: Props) {
  const { orgSlug } = await params;
  const { organisation, membership } = await requireOrgMembership(orgSlug);
  const ownerView = canManageMembers(membership);
  const adminView = isOrgAdmin(membership.role);
  const h = await headers();

  const members = await prisma.membership.findMany({
    where: { organisationId: organisation.id },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });

  const invites = adminView
    ? await prisma.organisationInvite.findMany({
        where: {
          organisationId: organisation.id,
          usedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, token: true, createdAt: true, expiresAt: true },
      })
    : [];

  const baseUrl: string =
    process.env.NEXT_PUBLIC_BASE_URL ??
    (() => {
      const proto = h.get("x-forwarded-proto") ?? "http";
      const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
      return `${proto}://${host}`;
    })();

  return (
    <Stack spacing={3}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.5, sm: 3 },
          borderRadius: "20px",
          borderColor: "rgba(255,255,255,0.09)",
          background: "linear-gradient(120deg, rgba(10,132,255,0.12), rgba(28,28,30,0.96) 65%)",
        }}
      >
        <Typography variant="overline" sx={{ color: "#0A84FF", fontWeight: 700, letterSpacing: "1.4px", lineHeight: 1.3 }}>
          Organisation people
        </Typography>
        <Typography variant="h4" component="h1" sx={{ mt: 0.5, fontWeight: 700, letterSpacing: "-1px" }}>
          Members
        </Typography>
        <Typography variant="body2" sx={{ mt: 1, color: "rgba(255,255,255,0.6)" }}>
          {ownerView
            ? "Manage roles, invite collaborators, and keep your workspace in good shape."
            : adminView
              ? "Invite collaborators and manage the members of this workspace."
              : "Everyone who belongs to this organisation."}
        </Typography>
      </Paper>

      {adminView ? (
        <OrgInviteLinkPanel
          organisationSlug={organisation.slug}
          baseUrl={baseUrl}
          invites={invites.map((i) => ({
            ...i,
            createdAt: i.createdAt.toISOString(),
            expiresAt: i.expiresAt ? i.expiresAt.toISOString() : null,
          }))}
        />
      ) : null}

      {members.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: "center", borderRadius: "16px", borderColor: "rgba(255,255,255,0.08)", backgroundColor: "rgba(255,255,255,0.025)" }}>
          <Typography color="text.secondary">No members found.</Typography>
        </Paper>
      ) : (
        <TableContainer
          component={Paper}
          variant="outlined"
          sx={{
            overflow: "hidden",
            borderRadius: "18px",
            borderColor: "rgba(255,255,255,0.09)",
            backgroundColor: "rgba(28,28,30,0.88)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.1)",
          }}
        >
          <Table size="small" sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow sx={{ backgroundColor: "rgba(255,255,255,0.035)" }}>
                <TableCell sx={{ py: 1.5, color: "rgba(255,255,255,0.52)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.75px", textTransform: "uppercase" }}>Member</TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" }, py: 1.5, color: "rgba(255,255,255,0.52)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.75px", textTransform: "uppercase" }}>Email</TableCell>
                <TableCell sx={{ py: 1.5, color: "rgba(255,255,255,0.52)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.75px", textTransform: "uppercase" }}>Role & actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((m) => (
                <TableRow
                  key={m.id}
                  hover
                  sx={{
                    "&:last-child td, &:last-child th": { borderBottom: 0 },
                    "&:hover": { backgroundColor: "rgba(255,255,255,0.035)" },
                  }}
                >
                  <TableCell sx={{ py: 1.5 }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                      <Avatar
                        sx={{
                          width: 36,
                          height: 36,
                          fontSize: "0.85rem",
                          fontWeight: 700,
                          color: "#fff",
                          background: "linear-gradient(135deg, rgba(10,132,255,0.9), rgba(185,174,255,0.75))",
                        }}
                      >
                        {(m.user.name ?? m.user.email ?? "?").trim().slice(0, 1).toUpperCase()}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 650 }} noWrap>
                          {m.user.name ?? "Unnamed member"}
                        </Typography>
                        <Typography variant="caption" sx={{ display: { xs: "block", sm: "none" }, color: "text.secondary" }} noWrap>
                          {m.user.email ?? "—"}
                        </Typography>
                      </Box>
                    </Stack>
                  </TableCell>
                  <TableCell sx={{ display: { xs: "none", sm: "table-cell" }, color: "text.secondary" }}>{m.user.email ?? "—"}</TableCell>
                  <TableCell sx={{ py: 1.25 }}>
                    <MemberRoleActions
                      organisationSlug={organisation.slug}
                      targetUserId={m.userId}
                      role={m.role}
                      actorRole={membership.role}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}
