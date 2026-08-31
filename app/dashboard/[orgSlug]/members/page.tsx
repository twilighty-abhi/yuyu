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
import Button from "@mui/material/Button";
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

type Props = { params: Promise<{ orgSlug: string }>; searchParams: Promise<{ page?: string }> };
const MEMBERS_PAGE_SIZE = 100;

export const metadata: Metadata = {
  title: "Members",
  description: "Organisation members and roles.",
};

export default async function OrgMembersPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;
  const requestedPage = Math.max(1, Number.parseInt((await searchParams).page ?? "1", 10) || 1);
  const { organisation, membership } = await requireOrgMembership(orgSlug);
  const ownerView = canManageMembers(membership);
  const adminView = isOrgAdmin(membership.role);
  const h = await headers();

  const memberCount = await prisma.membership.count({ where: { organisationId: organisation.id } });
  const memberPages = Math.max(1, Math.ceil(memberCount / MEMBERS_PAGE_SIZE));
  const memberPage = Math.min(requestedPage, memberPages);
  const members = await prisma.membership.findMany({
    where: { organisationId: organisation.id },
    select: { id: true, userId: true, role: true, createdAt: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
    skip: (memberPage - 1) * MEMBERS_PAGE_SIZE,
    take: MEMBERS_PAGE_SIZE,
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
    <Stack spacing={3.5} sx={{ pb: 2 }}>
      <Stack spacing={0.5} sx={{ px: { xs: 0.5, sm: 0 } }}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.5px" }}>
          Members
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {ownerView
            ? "Manage roles, invite collaborators, and keep your workspace in good shape."
            : adminView
              ? "Invite collaborators and manage the members of this workspace."
              : "Everyone who belongs to this organisation."}
        </Typography>
      </Stack>

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
            boxShadow: "none",
          }}
        >
          <Table size="small" sx={{ minWidth: 560 }}>
            <TableHead>
              <TableRow sx={{ backgroundColor: "rgba(255,255,255,0.025)" }}>
                <TableCell sx={{ py: 1.25, color: "rgba(255,255,255,0.48)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase" }}>Member</TableCell>
                <TableCell sx={{ display: { xs: "none", sm: "table-cell" }, py: 1.25, color: "rgba(255,255,255,0.48)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase" }}>Email</TableCell>
                <TableCell sx={{ py: 1.25, color: "rgba(255,255,255,0.48)", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.7px", textTransform: "uppercase" }}>Access</TableCell>
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
      {memberPages > 1 ? <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end", alignItems: "center" }}><Typography variant="body2" color="text.secondary">Page {memberPage} of {memberPages}</Typography><Button href={`?page=${memberPage - 1}`} disabled={memberPage <= 1}>Previous</Button><Button href={`?page=${memberPage + 1}`} disabled={memberPage >= memberPages}>Next</Button></Stack> : null}
    </Stack>
  );
}
