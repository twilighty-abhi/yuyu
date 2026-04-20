import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const orgs = await prisma.organisation.findMany({
    where: {
      memberships: { some: { userId: session.user.id } },
    },
    orderBy: { name: "asc" },
  });

  return (
    <Stack spacing={3} sx={{ py: 2 }}>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={2}
        sx={{
          justifyContent: "space-between",
          alignItems: { xs: "stretch", sm: "center" },
        }}
      >
        <Typography variant="h4" component="h1">
          Your organisations
        </Typography>
        <Button component={Link} href="/dashboard/org/new" variant="contained">
          New organisation
        </Button>
      </Stack>
      {orgs.length === 0 ? (
        <Typography color="text.secondary">
          You are not in any organisation yet. Create one to start hosting
          events.
        </Typography>
      ) : (
        <Stack spacing={2}>
          {orgs.map((org) => (
            <Card key={org.id} variant="outlined">
              <CardActionArea component={Link} href={`/${org.slug}`}>
                <CardContent>
                  <Typography variant="h6">{org.name}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    /{org.slug}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Stack>
  );
}
