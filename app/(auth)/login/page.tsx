import Box from "@mui/material/Box";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { LoginForm } from "./ui";

export default function LoginPage() {
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: { xs: 2, sm: 3, md: 4 },
        overflow: "auto",
        background:
          "radial-gradient(1000px 600px at 18% 18%, rgba(124, 245, 182, 0.18), transparent 55%), radial-gradient(900px 600px at 88% 22%, rgba(185, 174, 255, 0.12), transparent 55%), linear-gradient(135deg, rgba(6,18,14,1) 0%, rgba(8,26,20,1) 55%, rgba(10,30,24,1) 120%)",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "min(1180px, 100%)",
          minHeight: { md: 640 },
          overflow: "hidden",
          borderRadius: 3,
          border: "1px solid",
          borderColor: "rgba(255,255,255,0.10)",
          backgroundColor: "rgba(10, 24, 18, 0.62)",
          backdropFilter: "blur(10px)",
          boxShadow: "0 30px 90px rgba(0,0,0,0.45)",
        }}
      >
        <Grid container>
          <Grid size={{ xs: 12, md: 5 }}>
            <Box sx={{ p: { xs: 3, sm: 4 } }}>
              <Stack spacing={2.5}>
                <Box>
                  <Typography
                    variant="overline"
                    sx={{
                      letterSpacing: 1.4,
                      color: "rgba(255,255,255,0.78)",
                    }}
                  >
                    YUYU
                  </Typography>
                  <Typography
                    variant="h4"
                    component="h1"
                    sx={{ fontWeight: 700, color: "common.white" }}
                  >
                    Get started now
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: "rgba(255,255,255,0.70)", mt: 0.75 }}
                  >
                    Use Google or email — email sends a magic link (stub logs to
                    the server console in development).
                  </Typography>
                </Box>

                <Box
                  sx={{
                    borderRadius: 2,
                    border: "1px solid",
                    borderColor: "rgba(255,255,255,0.10)",
                    backgroundColor: "rgba(6, 18, 14, 0.42)",
                    p: { xs: 2.25, sm: 2.75 },
                  }}
                >
                  <LoginForm />
                </Box>
              </Stack>
            </Box>
          </Grid>

          <Grid
            size={{ xs: 12, md: 7 }}
            sx={{ display: { xs: "none", md: "block" } }}
          >
            <Box
              sx={{
                height: "100%",
                minHeight: 640,
                backgroundColor: "rgba(255,255,255,0.04)",
                position: "relative",
              }}
            >
              <Box
                component="img"
                src="/login-hero.svg"
                alt=""
                sx={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  background:
                    "linear-gradient(90deg, rgba(10, 24, 18, 0.92) 0%, rgba(10, 24, 18, 0.34) 44%, rgba(10, 24, 18, 0.12) 100%)",
                }}
              />
            </Box>
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
}
