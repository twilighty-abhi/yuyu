import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import BusinessIcon from "@mui/icons-material/Business";
import AddIcon from "@mui/icons-material/Add";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import EventIcon from "@mui/icons-material/Event";
import PeopleIcon from "@mui/icons-material/People";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) return null;

  const orgs = await prisma.organisation.findMany({
    where: {
      memberships: { some: { userId: session.user.id } },
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      _count: { select: { events: true, memberships: true } },
    },
  });

  return (
    <Stack spacing={3} sx={{ py: 2 }}>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2, sm: 3 },
          borderRadius: 3,
          overflow: "hidden",
          position: "relative",
          background:
            "linear-gradient(135deg, rgba(25,118,210,0.10), rgba(156,39,176,0.08))",
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(600px circle at 0% 0%, rgba(25,118,210,0.18), transparent 55%), radial-gradient(600px circle at 100% 0%, rgba(156,39,176,0.14), transparent 55%)",
          }}
        />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{
            position: "relative",
            justifyContent: "space-between",
            alignItems: { xs: "stretch", sm: "center" },
          }}
        >
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <BusinessIcon fontSize="small" />
              <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
                Dashboard
              </Typography>
              <Chip
                size="small"
                label={`${orgs.length} org${orgs.length === 1 ? "" : "s"}`}
                variant="outlined"
              />
            </Stack>
            <Typography color="text.secondary">
              Pick an organisation to manage events, members, and RSVPs.
            </Typography>
          </Stack>

          <Link href="/dashboard/org/new" style={{ textDecoration: "none" }}>
            <Button
              variant="contained"
              component="span"
              startIcon={<AddIcon />}
              sx={{ alignSelf: { xs: "flex-start", sm: "center" } }}
            >
              New organisation
            </Button>
          </Link>
        </Stack>
      </Paper>

      {orgs.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, borderRadius: 3, textAlign: "center" }}>
          <Stack spacing={1.5} sx={{ alignItems: "center" }}>
            <Avatar sx={{ bgcolor: "primary.main", width: 56, height: 56 }}>
              <BusinessIcon />
            </Avatar>
            <Typography variant="h6">No organisations yet</Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 520 }}>
              Create your first organisation to start hosting events and managing
              RSVPs.
            </Typography>
            <Link href="/dashboard/org/new" style={{ textDecoration: "none" }}>
              <Button variant="contained" component="span" startIcon={<AddIcon />}>
                Create organisation
              </Button>
            </Link>
          </Stack>
        </Paper>
      ) : (
        <Grid container spacing={2}>
          {orgs.map((org) => (
            <Grid key={org.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card
                variant="outlined"
                sx={{
                  height: "100%",
                  borderRadius: 3,
                  transition: "transform 120ms ease, box-shadow 120ms ease",
                  "&:hover": {
                    transform: "translateY(-2px)",
                    boxShadow: 3,
                  },
                }}
              >
                <Link
                  href={`/dashboard/${org.slug}`}
                  style={{
                    textDecoration: "none",
                    color: "inherit",
                    display: "block",
                    height: "100%",
                  }}
                >
                  <CardActionArea component="div" sx={{ height: "100%" }}>
                    <CardContent
                      sx={{
                        height: "100%",
                        p: { xs: 2.25, sm: 2.75 },
                      }}
                    >
                      <Stack spacing={2} sx={{ height: "100%" }}>
                        <Stack
                          direction="row"
                          spacing={1.5}
                          sx={{ alignItems: "center" }}
                        >
                          <Avatar
                            variant="rounded"
                            sx={{
                              bgcolor: "action.selected",
                              color: "text.primary",
                              width: 48,
                              height: 48,
                              borderRadius: 2,
                            }}
                          >
                            {org.name.trim().slice(0, 1).toUpperCase()}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              variant="h6"
                              sx={{ fontWeight: 650, lineHeight: 1.2 }}
                              noWrap
                            >
                              {org.name}
                            </Typography>
                            <Typography
                              variant="body2"
                              color="text.secondary"
                              sx={{ mt: 0.25 }}
                              noWrap
                            >
                              /{org.slug}
                            </Typography>
                          </Box>
                        </Stack>

                        <Stack
                          direction="row"
                          useFlexGap
                          sx={{ flexWrap: "wrap", columnGap: 1, rowGap: 1 }}
                        >
                          <Chip
                            size="small"
                            avatar={
                              <Avatar
                                sx={{
                                  width: 22,
                                  height: 22,
                                  bgcolor: "transparent",
                                  color: "text.secondary",
                                }}
                              >
                                <EventIcon sx={{ fontSize: 16 }} />
                              </Avatar>
                            }
                            label={`${org._count.events} event${org._count.events === 1 ? "" : "s"}`}
                            variant="outlined"
                            sx={{
                              height: 28,
                              "& .MuiChip-label": { px: 1 },
                            }}
                          />
                          <Chip
                            size="small"
                            avatar={
                              <Avatar
                                sx={{
                                  width: 22,
                                  height: 22,
                                  bgcolor: "transparent",
                                  color: "text.secondary",
                                }}
                              >
                                <PeopleIcon sx={{ fontSize: 16 }} />
                              </Avatar>
                            }
                            label={`${org._count.memberships} member${org._count.memberships === 1 ? "" : "s"}`}
                            variant="outlined"
                            sx={{
                              height: 28,
                              "& .MuiChip-label": { px: 1 },
                            }}
                          />
                        </Stack>

                        <Box sx={{ flex: 1 }} />
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{
                            alignItems: "center",
                            color: "primary.main",
                            pt: 1.5,
                            borderTop: "1px solid",
                            borderColor: "divider",
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            Open organiser dashboard
                          </Typography>
                          <ArrowForwardIcon fontSize="small" />
                        </Stack>
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                </Link>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Stack>
  );
}
