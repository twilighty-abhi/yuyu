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

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your organisations, events, and RSVPs.",
};

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
    <Stack spacing={4} sx={{ py: 3 }}>
      {/* Premium Glass Header Card */}
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 3, sm: 4 },
          borderRadius: 4,
          overflow: "hidden",
          position: "relative",
          background:
            "linear-gradient(135deg, rgba(124, 245, 182, 0.08) 0%, rgba(185, 174, 255, 0.05) 100%)",
          borderColor: "rgba(255, 255, 255, 0.06)",
        }}
      >
        <Box
          aria-hidden
          sx={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(600px circle at 0% 0%, rgba(124, 245, 182, 0.15), transparent 55%), radial-gradient(600px circle at 100% 0%, rgba(185, 174, 255, 0.1), transparent 55%)",
          }}
        />
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{
            position: "relative",
            justifyContent: "space-between",
            alignItems: { xs: "stretch", sm: "center" },
            zIndex: 1,
          }}
        >
          <Stack spacing={1}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <BusinessIcon sx={{ color: "#7CF5B6" }} />
              <Typography variant="h4" component="h1" sx={{ fontWeight: 850, letterSpacing: "-0.5px" }}>
                Dashboard
              </Typography>
              <Chip
                size="small"
                label={`${orgs.length} org${orgs.length === 1 ? "" : "s"}`}
                variant="outlined"
                sx={{
                  bgcolor: "rgba(124, 245, 182, 0.08)",
                  color: "#7CF5B6",
                  borderColor: "rgba(124, 245, 182, 0.2)",
                  fontWeight: 700,
                }}
              />
            </Stack>
            <Typography variant="body2" sx={{ color: "rgba(255, 255, 255, 0.65)" }}>
              Manage organizations, edit public listings, configure registration fields, and track RSVPs.
            </Typography>
          </Stack>

          <Link href="/dashboard/org/new" style={{ textDecoration: "none" }}>
            <Button
              variant="contained"
              component="span"
              startIcon={<AddIcon />}
              sx={{
                alignSelf: { xs: "flex-start", sm: "center" },
                background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                color: "#061814",
                fontWeight: 700,
                borderRadius: 2.5,
                px: 3.5,
                py: 1,
                boxShadow: "0 4px 15px rgba(124, 245, 182, 0.2)",
                "&:hover": {
                  background: "linear-gradient(135deg, #90ffd0 0%, #cac0ff 100%)",
                },
              }}
            >
              New organisation
            </Button>
          </Link>
        </Stack>
      </Paper>

      {orgs.length === 0 ? (
        <Paper
          variant="outlined"
          sx={{
            p: 6,
            borderRadius: 4,
            textAlign: "center",
            backgroundColor: "rgba(255, 255, 255, 0.01)",
            borderColor: "rgba(255, 255, 255, 0.06)",
          }}
        >
          <Stack spacing={2} sx={{ alignItems: "center" }}>
            <Avatar
              sx={{
                bgcolor: "rgba(124, 245, 182, 0.08)",
                color: "#7CF5B6",
                width: 56,
                height: 56,
                border: "1px solid rgba(124, 245, 182, 0.15)",
              }}
            >
              <BusinessIcon />
            </Avatar>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              No organisations yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 440, lineHeight: 1.6 }}>
              Create your first organisation to start hosting events, managing memberships, and collecting RSVPs.
            </Typography>
            <Box sx={{ pt: 1.5 }}>
              <Link href="/dashboard/org/new" style={{ textDecoration: "none" }}>
                <Button
                  variant="contained"
                  component="span"
                  startIcon={<AddIcon />}
                  sx={{
                    background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                    color: "#061814",
                    fontWeight: 700,
                    borderRadius: 2.5,
                    px: 3.5,
                  }}
                >
                  Create organisation
                </Button>
              </Link>
            </Box>
          </Stack>
        </Paper>
      ) : (
        <Grid container spacing={3}>
          {orgs.map((org) => (
            <Grid key={org.id} size={{ xs: 12, sm: 6, md: 4 }}>
              <Card
                variant="outlined"
                sx={{
                  height: "100%",
                  borderRadius: 4,
                  backgroundColor: "rgba(255, 255, 255, 0.01)",
                  borderColor: "rgba(255, 255, 255, 0.06)",
                  transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                  "&:hover": {
                    transform: "translateY(-4px)",
                    borderColor: "rgba(124, 245, 182, 0.25)",
                    backgroundColor: "rgba(124, 245, 182, 0.01)",
                    boxShadow: "0 15px 40px rgba(0, 0, 0, 0.25)",
                    "& .arrow-icon": {
                      transform: "translateX(4px)",
                    },
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
                        p: { xs: 2.5, sm: 3 },
                      }}
                    >
                      <Stack spacing={2.5} sx={{ height: "100%" }}>
                        <Stack
                          direction="row"
                          spacing={1.75}
                          sx={{ alignItems: "center" }}
                        >
                          <Avatar
                            variant="rounded"
                            sx={{
                              background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                              color: "#061814",
                              width: 48,
                              height: 48,
                              borderRadius: 2.5,
                              fontWeight: 800,
                            }}
                          >
                            {org.name.trim().slice(0, 1).toUpperCase()}
                          </Avatar>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              variant="h6"
                              sx={{ fontWeight: 800, lineHeight: 1.2 }}
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
                            icon={<EventIcon sx={{ fontSize: 16 }} />}
                            label={`${org._count.events} event${org._count.events === 1 ? "" : "s"}`}
                            variant="outlined"
                            sx={{
                              height: 28,
                              borderRadius: 1.5,
                              "& .MuiChip-label": { px: 1 },
                            }}
                          />
                          <Chip
                            size="small"
                            icon={<PeopleIcon sx={{ fontSize: 16 }} />}
                            label={`${org._count.memberships} member${org._count.memberships === 1 ? "" : "s"}`}
                            variant="outlined"
                            sx={{
                              height: 28,
                              borderRadius: 1.5,
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
                            borderColor: "rgba(255, 255, 255, 0.06)",
                          }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 700, color: "#7CF5B6" }}>
                            Open organiser dashboard
                          </Typography>
                          <ArrowForwardIcon
                            className="arrow-icon"
                            fontSize="small"
                            sx={{
                              color: "#7CF5B6",
                              transition: "transform 0.2s ease-in-out",
                            }}
                          />
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
