"use client";

import React, { useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Grid from "@mui/material/Grid";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import EventAvailableOutlinedIcon from "@mui/icons-material/EventAvailableOutlined";
import GroupsOutlinedIcon from "@mui/icons-material/GroupsOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import MailOutlineOutlinedIcon from "@mui/icons-material/MailOutlineOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import CheckCircleOutlineOutlinedIcon from "@mui/icons-material/CheckCircleOutlineOutlined";
import StarsIcon from "@mui/icons-material/Stars";

// Animation Variants
const fadeInUp = {
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
} as any;

const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.15,
    },
  },
} as any;

const floatAnimation = {
  animate: {
    y: [0, -12, 0],
    transition: {
      duration: 5,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
} as any;

export function LandingPageClient(props: { getStartedHref: string }) {
  const { getStartedHref } = props;
  const [activeTab, setActiveTab] = useState<"rsvp" | "waitlist" | "checkin">("rsvp");

  // Grid background style
  const gridBackground = {
    backgroundImage: `
      linear-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.03) 1px, transparent 1px)
    `,
    backgroundSize: "40px 40px",
    backgroundPosition: "center top",
  };

  return (
    <Box sx={{ overflow: "hidden", pb: 10 }}>
      {/* ── HERO SECTION ── */}
      <Box
        sx={{
          position: "relative",
          pt: { xs: 4, md: 8 },
          pb: { xs: 8, md: 12 },
          ...gridBackground,
        }}
      >
        {/* Glow Effects */}
        <Box
          sx={{
            position: "absolute",
            top: "10%",
            left: "15%",
            width: "350px",
            height: "350px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(124, 245, 182, 0.15) 0%, transparent 70%)",
            filter: "blur(60px)",
            pointerEvents: "none",
          }}
        />
        <Box
          sx={{
            position: "absolute",
            top: "20%",
            right: "10%",
            width: "400px",
            height: "400px",
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(185, 174, 255, 0.12) 0%, transparent 70%)",
            filter: "blur(70px)",
            pointerEvents: "none",
          }}
        />

        <Grid container spacing={5} sx={{ alignItems: "center", position: "relative", zIndex: 1 }}>
          {/* Hero Left Content */}
          <Grid size={{ xs: 12, md: 6.5 }}>
            <motion.div
              initial="hidden"
              animate="visible"
              variants={staggerContainer}
            >
              <motion.div variants={fadeInUp}>
                <Box
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 1,
                    px: 2,
                    py: 0.75,
                    borderRadius: 999,
                    border: "1px solid rgba(124, 245, 182, 0.2)",
                    backgroundColor: "rgba(124, 245, 182, 0.06)",
                    mb: 3,
                  }}
                >
                  <StarsIcon sx={{ fontSize: 16, color: "#7CF5B6" }} />
                  <Typography variant="caption" sx={{ color: "#7CF5B6", fontWeight: 700, letterSpacing: 0.5 }}>
                    OPEN SOURCE & SELF-HOSTED
                  </Typography>
                </Box>
              </motion.div>

              <motion.div variants={fadeInUp}>
                <Typography
                  variant="h1"
                  sx={{
                    fontWeight: 900,
                    fontSize: { xs: "2.75rem", sm: "3.75rem", md: "4.5rem" },
                    lineHeight: 1.05,
                    letterSpacing: "-1.5px",
                    mb: 2.5,
                  }}
                >
                  Host events people{" "}
                  <Box
                    component="span"
                    sx={{
                      background: "linear-gradient(135deg, #7CF5B6 10%, #B9AEFF 100%)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    actually show up
                  </Box>{" "}
                  to.
                </Typography>
              </motion.div>

              <motion.div variants={fadeInUp}>
                <Typography
                  variant="body1"
                  sx={{
                    color: "rgba(255, 255, 255, 0.65)",
                    fontSize: { xs: "1.05rem", sm: "1.15rem" },
                    lineHeight: 1.6,
                    maxWidth: 580,
                    mb: 4,
                  }}
                >
                  Yuyu is a fully open-source, self-hosted developer-first platform. Set up in seconds to manage mixers, meetups, or hackathons with complete data ownership.
                </Typography>
              </motion.div>

              <motion.div variants={fadeInUp}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                  <Link href={getStartedHref} style={{ textDecoration: "none" }}>
                    <Button
                      variant="contained"
                      size="large"
                      component="span"
                      endIcon={<ArrowForwardIcon />}
                      sx={{
                        px: 4,
                        py: 1.5,
                        borderRadius: 2.5,
                        fontWeight: 700,
                        fontSize: "0.95rem",
                        boxShadow: "0 8px 25px rgba(124, 245, 182, 0.25)",
                        background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                        color: "#061814",
                        transition: "all 0.2s ease-in-out",
                        "&:hover": {
                          transform: "translateY(-2px)",
                          boxShadow: "0 12px 30px rgba(124, 245, 182, 0.4)",
                          background: "linear-gradient(135deg, #90ffd0 0%, #cac0ff 100%)",
                        },
                      }}
                    >
                      Start hosting free
                    </Button>
                  </Link>

                  <Link href="/discover" style={{ textDecoration: "none" }}>
                    <Button
                      variant="outlined"
                      size="large"
                      component="span"
                      sx={{
                        px: 4,
                        py: 1.5,
                        borderRadius: 2.5,
                        fontWeight: 700,
                        fontSize: "0.95rem",
                        borderColor: "rgba(255, 255, 255, 0.15)",
                        color: "#ffffff",
                        backdropFilter: "blur(10px)",
                        transition: "all 0.2s ease",
                        "&:hover": {
                          borderColor: "rgba(255, 255, 255, 0.35)",
                          backgroundColor: "rgba(255, 255, 255, 0.05)",
                          transform: "translateY(-1px)",
                        },
                      }}
                    >
                      Explore public events
                    </Button>
                  </Link>
                </Stack>
              </motion.div>
            </motion.div>
          </Grid>

          {/* Hero Right Visual (Floating Glass Dashboard Mockup) */}
          <Grid size={{ xs: 12, md: 5.5 }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, x: 20 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
            >
              <motion.div animate={floatAnimation.animate}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 3,
                    borderRadius: 5,
                    backgroundColor: "rgba(10, 24, 18, 0.55)",
                    backdropFilter: "blur(20px)",
                    borderColor: "rgba(124, 245, 182, 0.15)",
                    boxShadow: "0 30px 70px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
                    position: "relative",
                  }}
                >
                  {/* Decorative window circles */}
                  <Stack direction="row" spacing={1} sx={{ mb: 3 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "error.main", opacity: 0.7 }} />
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "warning.main", opacity: 0.7 }} />
                    <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: "success.main", opacity: 0.7 }} />
                  </Stack>

                  {/* Mock dashboard UI */}
                  <Stack spacing={2.5}>
                    <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center" }}>
                      <Box>
                        <Typography variant="caption" color="text.secondary">ORGANISATION EVENT</Typography>
                        <Typography variant="h6" sx={{ fontWeight: 800, color: "#fff", mt: 0.25 }}>Tech Founders Mixer</Typography>
                      </Box>
                      <Chip label="Published" size="small" sx={{ bgcolor: "rgba(124, 245, 182, 0.12)", color: "#7CF5B6", fontWeight: 700 }} />
                    </Stack>

                    <Divider sx={{ borderColor: "rgba(255,255,255,0.06)" }} />

                    {/* Dashboard Metrics */}
                    <Grid container spacing={2}>
                      <Grid size={4}>
                        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                          <Typography variant="caption" color="text.secondary">RSVPs</Typography>
                          <Typography variant="body1" sx={{ fontWeight: 800, mt: 0.5 }}>148 / 150</Typography>
                        </Box>
                      </Grid>
                      <Grid size={4}>
                        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                          <Typography variant="caption" color="text.secondary">Waitlisted</Typography>
                          <Typography variant="body1" sx={{ fontWeight: 800, mt: 0.5, color: "#B9AEFF" }}>24</Typography>
                        </Box>
                      </Grid>
                      <Grid size={4}>
                        <Box sx={{ p: 1.5, borderRadius: 2, bgcolor: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                          <Typography variant="caption" color="text.secondary">Attended</Typography>
                          <Typography variant="body1" sx={{ fontWeight: 800, mt: 0.5, color: "#7CF5B6" }}>92%</Typography>
                        </Box>
                      </Grid>
                    </Grid>

                    {/* Progress Bar */}
                    <Box>
                      <Stack direction="row" sx={{ justifyContent: "space-between", mb: 0.75 }}>
                        <Typography variant="caption" color="text.secondary">Capacity Fill Rate</Typography>
                        <Typography variant="caption" sx={{ fontWeight: 700 }}>98%</Typography>
                      </Stack>
                      <Box sx={{ width: "100%", height: 6, bgcolor: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden" }}>
                        <Box sx={{ width: "98%", height: "100%", bg: "linear-gradient(90deg, #7CF5B6, #B9AEFF)", borderRadius: 3 }} />
                      </Box>
                    </Box>

                    {/* Simulated Check-in logs */}
                    <Stack spacing={1}>
                      <Typography variant="caption" color="text.secondary">Live Check-in Stream</Typography>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", p: 1, borderRadius: 1.5, bgcolor: "rgba(124, 245, 182, 0.03)" }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#7CF5B6", boxShadow: "0 0 8px #7CF5B6" }} />
                        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.85)" }}><b>Arjun Sharma</b> checked in via QR code</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>1m ago</Typography>
                      </Stack>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", p: 1, borderRadius: 1.5, bgcolor: "rgba(255,255,255,0.01)" }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "#B9AEFF", opacity: 0.6 }} />
                        <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.85)" }}><b>Sarah Chen</b> joined the waitlist</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ ml: "auto" }}>5m ago</Typography>
                      </Stack>
                    </Stack>
                  </Stack>
                </Paper>
              </motion.div>
            </motion.div>
          </Grid>
        </Grid>
      </Box>

      {/* ── INTERACTIVE PREVIEW TABS ── */}
      <Box sx={{ py: { xs: 8, md: 12 } }}>
        <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", mb: 6 }}>
          <Typography variant="overline" sx={{ color: "#7CF5B6", fontWeight: 700, letterSpacing: 1.5 }}>
            FLAWLESS LIFECYCLE
          </Typography>
          <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: "-0.5px" }}>
            Designed for scaling organizers
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 550 }}>
            No more messy spreadsheets. Manage everything from dynamic registration fields to automated queue approvals in one place.
          </Typography>
        </Stack>

        {/* Tab Buttons */}
        <Stack direction="row" spacing={1.5} sx={{ justifyContent: "center", mb: 5, flexWrap: "wrap", gap: 1 }}>
          {[
            { id: "rsvp", label: "Flexible RSVP Customizer" },
            { id: "waitlist", label: "Smart Waitlist Rules" },
            { id: "checkin", label: "Door QR Check-in" },
          ].map((tab) => {
            const active = activeTab === tab.id;
            return (
              <Button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                variant={active ? "contained" : "outlined"}
                size="small"
                sx={{
                  borderRadius: 999,
                  px: 3,
                  py: 1,
                  textTransform: "none",
                  fontWeight: 700,
                  transition: "all 0.25s ease",
                  ...(active
                    ? {
                        background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                        color: "#061814",
                        border: "none",
                        boxShadow: "0 4px 15px rgba(124, 245, 182, 0.2)",
                      }
                    : {
                        borderColor: "rgba(255,255,255,0.1)",
                        color: "rgba(255,255,255,0.6)",
                        "&:hover": { borderColor: "rgba(255,255,255,0.3)" },
                      }),
                }}
              >
                {tab.label}
              </Button>
            );
          })}
        </Stack>

        {/* Interactive Content Box */}
        <Box sx={{ maxWidth: 880, mx: "auto", px: 2 }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.3 }}
            >
              <Paper
                variant="outlined"
                sx={{
                  p: { xs: 3, md: 5 },
                  borderRadius: 4,
                  backgroundColor: "rgba(255,255,255,0.015)",
                  borderColor: "rgba(255,255,255,0.08)",
                  boxShadow: "0 20px 50px rgba(0,0,0,0.3)",
                }}
              >
                <Grid container spacing={4} sx={{ alignItems: "center" }}>
                  <Grid size={{ xs: 12, md: 6 }}>
                    <Stack spacing={2}>
                      <Box sx={{ display: "inline-flex", p: 1, borderRadius: 2, bgcolor: "rgba(124, 245, 182, 0.08)", color: "#7CF5B6", alignSelf: "flex-start" }}>
                        {activeTab === "rsvp" && <EventAvailableOutlinedIcon />}
                        {activeTab === "waitlist" && <GroupsOutlinedIcon />}
                        {activeTab === "checkin" && <InsightsOutlinedIcon />}
                      </Box>
                      <Typography variant="h5" sx={{ fontWeight: 800 }}>
                        {activeTab === "rsvp" && "Dynamically customize fields for every event"}
                        {activeTab === "waitlist" && "Set maximum capacities and waitlist automation"}
                        {activeTab === "checkin" && "Check guests in instantly with security-first tickets"}
                      </Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                        {activeTab === "rsvp" &&
                          "Add text fields, checkboxes, dropdowns, or multi-select registration questions. Collect exactly the attendee details you need before giving away tickets."}
                        {activeTab === "waitlist" &&
                          "When registration capacity fills, attendees are placed on a waitlist. If an attendee cancels, Yuyu's backend automates waitlist promotions instantly."}
                        {activeTab === "checkin" &&
                          "Every confirmed attendee receives a unique check-in link and secure QR code. Organisers can use any mobile camera at the door to quickly scan and verify tickets."}
                      </Typography>

                      <Stack spacing={1} sx={{ pt: 1 }}>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                          <CheckCircleOutlineOutlinedIcon sx={{ fontSize: 16, color: "#7CF5B6" }} />
                          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.85)" }}>
                            {activeTab === "rsvp" && "Supports Date, Checkbox, Select & Phone inputs"}
                            {activeTab === "waitlist" && "Instant automated waitlist promotions"}
                            {activeTab === "checkin" && "No extra scanner app required"}
                          </Typography>
                        </Stack>
                        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
                          <CheckCircleOutlineOutlinedIcon sx={{ fontSize: 16, color: "#7CF5B6" }} />
                          <Typography variant="caption" sx={{ color: "rgba(255,255,255,0.85)" }}>
                            {activeTab === "rsvp" && "Draggable form ordering configuration"}
                            {activeTab === "waitlist" && "Manual override approvals or rejections"}
                            {activeTab === "checkin" && "Real-time door metrics and csv logs"}
                          </Typography>
                        </Stack>
                      </Stack>
                    </Stack>
                  </Grid>

                  <Grid size={{ xs: 12, md: 6 }}>
                    {/* Feature visual panel */}
                    <Box
                      sx={{
                        p: 3,
                        borderRadius: 3,
                        backgroundColor: "rgba(0, 0, 0, 0.35)",
                        border: "1px solid rgba(255, 255, 255, 0.05)",
                        minHeight: 240,
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                      }}
                    >
                      {activeTab === "rsvp" && (
                        <Stack spacing={2}>
                          <Typography variant="subtitle2" sx={{ color: "#fff", fontWeight: 700 }}>Registration Form Preview</Typography>
                          <TextField label="Full Name" size="small" placeholder="Jane Doe" disabled sx={{ input: { color: "#fff" } }} />
                          <TextField label="Developer Experience" select size="small" defaultValue="senior" disabled sx={{ select: { color: "#fff" } }}>
                            <MenuItem value="senior">Senior Developer</MenuItem>
                          </TextField>
                          <Button variant="contained" disabled size="small" sx={{ alignSelf: "flex-start", bgcolor: "rgba(124, 245, 182, 0.2)" }}>
                            Register
                          </Button>
                        </Stack>
                      )}

                      {activeTab === "waitlist" && (
                        <Stack spacing={1.5}>
                          <Typography variant="subtitle2" sx={{ color: "#fff", fontWeight: 700 }}>Waitlist Promotion Flow</Typography>
                          <Paper sx={{ p: 1.5, bgcolor: "rgba(255, 255, 255, 0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                              <Typography variant="caption" sx={{ fontWeight: 700 }}>1. Arjun Verma</Typography>
                              <Chip label="Promoted" size="small" color="success" sx={{ height: 20 }} />
                            </Stack>
                          </Paper>
                          <Paper sx={{ p: 1.5, bgcolor: "rgba(255, 255, 255, 0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
                            <Stack direction="row" sx={{ justifyContent: "space-between" }}>
                              <Typography variant="caption" sx={{ fontWeight: 700 }}>2. Kelly Wong</Typography>
                              <Chip label="Waitlisted" size="small" sx={{ height: 20 }} />
                            </Stack>
                          </Paper>
                        </Stack>
                      )}

                      {activeTab === "checkin" && (
                        <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center" }}>
                          <Typography variant="subtitle2" sx={{ color: "#fff", fontWeight: 700 }}>Instant Door Check-in</Typography>
                          {/* QR Mock */}
                          <Box sx={{ p: 2, bgcolor: "#fff", borderRadius: 2, width: 100, height: 100, display: "flex", justifyContent: "center", alignItems: "center" }}>
                            <Box sx={{ width: 80, height: 80, border: "4px solid #000" }} />
                          </Box>
                          <Chip label="Valid Ticket Verified" color="success" size="small" />
                        </Stack>
                      )}
                    </Box>
                  </Grid>
                </Grid>
              </Paper>
            </motion.div>
          </AnimatePresence>
        </Box>
      </Box>

      {/* ── SAAS FEATURE CARDS ── */}
      <Box sx={{ py: { xs: 8, md: 10 } }}>
        <Stack spacing={2} sx={{ alignItems: "center", textAlign: "center", mb: 8 }}>
          <Typography variant="overline" sx={{ color: "#7CF5B6", fontWeight: 700, letterSpacing: 1.5 }}>
            ALL-IN-ONE PLATFORM
          </Typography>
          <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: "-0.5px" }}>
            Host events with absolute confidence
          </Typography>
        </Stack>

        <Grid container spacing={3}>
          {[
            {
              title: "Organisations & Teams",
              desc: "Create team profiles, delegate access levels, and assign member or administrator roles with absolute isolation.",
              icon: ShieldOutlinedIcon,
            },
            {
              title: "SEO-Optimized Public Pages",
              desc: "Dynamic, fast public pages optimized for indexing with OpenGraph support, metadata customization, and interactive calendars.",
              icon: LinkOutlinedIcon,
            },
            {
              title: "Granular RSVP Lifecycles",
              desc: "Manage tickets across Pending, Approved, Waitlisted, and Cancelled states. Auto-revalidate cache states dynamically.",
              icon: GroupsOutlinedIcon,
            },
            {
              title: "Outreach & Invitations",
              desc: "Send personalized email tickets directly from Yuyu's email invite panel with standard mail transport supports.",
              icon: MailOutlineOutlinedIcon,
            },
            {
              title: "Check-in Analytics",
              desc: "Review live capacity percentages, scan check-in ratios, and export door metrics dynamically to CSV.",
              icon: InsightsOutlinedIcon,
            },
            {
              title: "Capacity Limits & Caps",
              desc: "Configure exact capacity guidelines, automatically trigger waitlists, and override values for VIP entries.",
              icon: EventAvailableOutlinedIcon,
            },
          ].map((feature, index) => {
            const IconComponent = feature.icon;
            return (
              <Grid key={index} size={{ xs: 12, sm: 6, md: 4 }}>
                <motion.div
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true, margin: "-50px" }}
                  variants={{
                    hidden: { opacity: 0, y: 25 },
                    visible: { opacity: 1, y: 0, transition: { duration: 0.5, delay: index * 0.1 } },
                  }}
                >
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 3.5,
                      borderRadius: 4,
                      height: "100%",
                      backgroundColor: "rgba(255, 255, 255, 0.01)",
                      borderColor: "rgba(255, 255, 255, 0.06)",
                      transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                      "&:hover": {
                        transform: "translateY(-5px)",
                        borderColor: "rgba(124, 245, 182, 0.25)",
                        backgroundColor: "rgba(124, 245, 182, 0.01)",
                        boxShadow: "0 15px 40px rgba(124, 245, 182, 0.05)",
                      },
                    }}
                  >
                    <Box
                      sx={{
                        width: 48,
                        height: 48,
                        borderRadius: 2,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: "rgba(124, 245, 182, 0.08)",
                        color: "#7CF5B6",
                        mb: 2.5,
                      }}
                    >
                      <IconComponent />
                    </Box>
                    <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>
                      {feature.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                      {feature.desc}
                    </Typography>
                  </Paper>
                </motion.div>
              </Grid>
            );
          })}
        </Grid>
      </Box>

      {/* ── CALL TO ACTION SECTION ── */}
      <Box sx={{ py: { xs: 6, md: 10 } }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <Paper
            variant="outlined"
            sx={{
              p: { xs: 4, md: 8 },
              borderRadius: 6,
              background: `
                radial-gradient(circle at 100% 0%, rgba(124, 245, 182, 0.15) 0%, transparent 60%),
                radial-gradient(circle at 0% 100%, rgba(185, 174, 255, 0.10) 0%, transparent 60%),
                linear-gradient(135deg, rgba(255,255,255,0.015) 0%, rgba(255,255,255,0.005) 100%)
              `,
              borderColor: "rgba(255,255,255,0.08)",
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
              boxShadow: "0 30px 60px rgba(0,0,0,0.3)",
            }}
          >
            <Stack spacing={3} sx={{ alignItems: "center", position: "relative", zIndex: 1 }}>
              <Typography variant="h3" sx={{ fontWeight: 800, letterSpacing: "-1px" }}>
                Ready to run your next mixer?
              </Typography>
              <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 500, lineHeight: 1.6 }}>
                Deploy Yuyu on your own server, retain 100% data ownership, and manage meetups with absolute control. Open source under MIT.
              </Typography>
              <Link href={getStartedHref} style={{ textDecoration: "none" }}>
                <Button
                  variant="contained"
                  size="large"
                  component="span"
                  endIcon={<KeyboardArrowRightIcon />}
                  sx={{
                    px: 5,
                    py: 1.75,
                    borderRadius: 999,
                    fontWeight: 700,
                    fontSize: "0.95rem",
                    boxShadow: "0 8px 25px rgba(124, 245, 182, 0.25)",
                    background: "linear-gradient(135deg, #7CF5B6 0%, #B9AEFF 100%)",
                    color: "#061814",
                    transition: "all 0.2s ease-in-out",
                    "&:hover": {
                      transform: "translateY(-2px)",
                      boxShadow: "0 12px 30px rgba(124, 245, 182, 0.4)",
                      background: "linear-gradient(135deg, #90ffd0 0%, #cac0ff 100%)",
                    },
                  }}
                >
                  Get started now
                </Button>
              </Link>
            </Stack>
          </Paper>
        </motion.div>
      </Box>
    </Box>
  );
}
