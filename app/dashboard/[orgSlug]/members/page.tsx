import Typography from "@mui/material/Typography";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableContainer from "@mui/material/TableContainer";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import {
  canManageMembers,
  isOrgAdmin,
  requireOrgMembership,
} from "@/lib/permissions";
import { MemberRoleActions } from "@/components/members/MemberRoleActions";
import { OrgInviteLinkPanel } from "@/components/members/OrgInviteLinkPanel";

type Props = { params: Promise<{ orgSlug: string }> };

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
    <Stack spacing={2}>
      <Typography variant="h6" component="h2">
        Members
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {ownerView
          ? "As owner, you can change roles between admin and member, or remove people."
          : adminView
            ? "As admin, you can invite members and remove members."
            : "Organisation members and their roles."}
      </Typography>

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
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">No members found.</Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Email</TableCell>
                <TableCell>Role</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.user.name ?? "—"}</TableCell>
                  <TableCell>{m.user.email ?? "—"}</TableCell>
                  <TableCell>
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
