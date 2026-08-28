import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import BusinessOutlinedIcon from "@mui/icons-material/BusinessOutlined";
import { CreateOrgForm } from "@/components/org/CreateOrgForm";

export default function NewOrganisationPage() {
  return (
    <Stack
      spacing={3.5}
      sx={{
        width: "100%",
        maxWidth: 640,
        mx: "auto",
        py: { xs: 3, sm: 6 },
      }}
    >
      <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center" }}>
        <Box
          sx={{
            width: 48,
            height: 48,
            display: "grid",
            placeItems: "center",
            borderRadius: "14px",
            color: "primary.main",
            bgcolor: "rgba(10,132,255,0.12)",
          }}
        >
          <BusinessOutlinedIcon />
        </Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700, letterSpacing: "-0.75px" }}>
          Create an organisation
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 480 }}>
          Set up a workspace for your events and community. You&apos;ll be its owner.
        </Typography>
      </Stack>
      <Paper
        variant="outlined"
        sx={{
          p: { xs: 2.5, sm: 4 },
          borderRadius: "20px",
          borderColor: "rgba(255,255,255,0.1)",
          backgroundColor: "rgba(255,255,255,0.025)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.18)",
        }}
      >
        <Stack spacing={2.5}>
          <Stack spacing={0.5}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Organisation details
            </Typography>
            <Typography variant="body2" color="text.secondary">
              You can update these details whenever you need to.
            </Typography>
          </Stack>
          <Divider />
        <CreateOrgForm />
        </Stack>
      </Paper>
    </Stack>
  );
}
