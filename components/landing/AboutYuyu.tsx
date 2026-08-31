"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useSpring, type Variants } from "framer-motion";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ArrowDownwardOutlinedIcon from "@mui/icons-material/ArrowDownwardOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import Diversity3OutlinedIcon from "@mui/icons-material/Diversity3Outlined";
import FavoriteBorderOutlinedIcon from "@mui/icons-material/FavoriteBorderOutlined";
import LocalActivityOutlinedIcon from "@mui/icons-material/LocalActivityOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import RocketLaunchOutlinedIcon from "@mui/icons-material/RocketLaunchOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Grid from "@mui/material/Grid";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";

const chapters = [
  { number: "01", eyebrow: "The person", title: "Hi, I’m Abhiram N J.", body: "I’m building Yuyu as a calmer way to bring people together. The starting point is simple: make free events easier to organise without turning every gathering into a transaction.", detail: "Because the best events are often the ones that begin with someone deciding there should be room for people to meet.", icon: PersonOutlineOutlinedIcon, lightAccent: "rgba(94, 234, 163, 0.3)", darkAccent: "rgba(124,245,182,0.16)" },
  { number: "02", eyebrow: "The craft", title: "Human intent, AI-assisted making.", body: "Yuyu is shaped by Abhiram’s product decisions and built with the help of AI tools. They help explore ideas and accelerate implementation, while the care, trade-offs, and responsibility stay human.", detail: "The point is not to automate the thoughtfulness out of building—it is to spend more time on the details that make the product kinder and more useful.", icon: AutoAwesomeOutlinedIcon, lightAccent: "rgba(183, 162, 255, 0.34)", darkAccent: "rgba(185,174,255,0.18)" },
  { number: "03", eyebrow: "The invitation", title: "Still becoming, alongside real communities.", body: "Yuyu is self-hosted, privacy-minded, and designed to grow with the people using it for workshops, meetups, and meaningful gatherings.", detail: "It is a work in progress—one that stays grounded in the simple belief that software should make hosting feel more human, not less.", icon: RocketLaunchOutlinedIcon, lightAccent: "rgba(255, 181, 132, 0.32)", darkAccent: "rgba(255,159,10,0.15)" },
] as const;

const principles = [
  { title: "Free means free", body: "No tickets to sell, payment flow to configure, or platform fee hiding behind the RSVP button.", icon: LocalActivityOutlinedIcon, color: "#E56B3F", surface: "rgba(255, 190, 145, 0.28)" },
  { title: "Your space, your data", body: "Self-host Yuyu and keep the operational choices, attendee relationships, and infrastructure in your hands.", icon: CloudOutlinedIcon, color: "#7564D8", surface: "rgba(190, 177, 255, 0.3)" },
  { title: "Privacy is structural", body: "Tenant boundaries, private storage, careful capabilities, and server-owned permissions are part of the foundation.", icon: ShieldOutlinedIcon, color: "#16855C", surface: "rgba(126, 230, 180, 0.28)" },
  { title: "Built around people", body: "From the first invitation to check-in and feedback, the experience should feel clear for hosts and guests alike.", icon: Diversity3OutlinedIcon, color: "#3571C8", surface: "rgba(142, 196, 255, 0.28)" },
] as const;

const gatheringTypes = ["Community meetups", "Workshops", "Campus events", "Volunteer gatherings", "Conferences", "Clubs & collectives"] as const;

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

export function AboutYuyu() {
  const storyRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const theme = useTheme();
  const isDark = theme.palette.mode === "dark";
  const { scrollYProgress } = useScroll({ target: storyRef, offset: ["start 78%", "end 72%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 100, damping: 28, mass: 0.35 });

  const heroBackground = isDark
    ? "radial-gradient(circle at 82% 18%, rgba(185,174,255,0.25), transparent 30%), radial-gradient(circle at 15% 85%, rgba(124,245,182,0.2), transparent 36%), linear-gradient(145deg, rgba(10,132,255,0.12), rgba(12,16,22,0.35) 68%)"
    : "radial-gradient(circle at 84% 16%, rgba(154,128,255,0.48), transparent 31%), radial-gradient(circle at 12% 88%, rgba(55,209,137,0.38), transparent 40%), radial-gradient(circle at 62% 100%, rgba(255,146,83,0.32), transparent 32%), linear-gradient(145deg, #E9FFF5 0%, #EEF0FF 52%, #FFF0E6 100%)";
  const strongInk = isDark ? "text.primary" : "#15243A";

  return (
    <Box sx={{ maxWidth: 1120, mx: "auto", py: { xs: 2, md: 5 }, pb: { xs: 7, md: 12 } }}>
      <Paper variant="outlined" sx={{ position: "relative", minHeight: { xs: 540, md: 600 }, overflow: "hidden", p: { xs: 3, sm: 5, md: 7 }, borderRadius: 5, background: heroBackground, borderColor: isDark ? "rgba(255,255,255,0.1)" : "rgba(90,112,148,0.18)", boxShadow: isDark ? "none" : "0 28px 80px rgba(63, 85, 120, 0.16)" }}>
        <motion.div aria-hidden animate={prefersReducedMotion ? undefined : { rotate: 360 }} transition={{ duration: 32, repeat: Infinity, ease: "linear" }} style={{ position: "absolute", width: 360, height: 360, border: "1px dashed rgba(10,132,255,0.28)", borderRadius: "50%", right: -110, top: -110 }} />
        <motion.div aria-hidden animate={prefersReducedMotion ? undefined : { y: [0, -12, 0], rotate: [0, 5, 0] }} transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }} style={{ position: "absolute", right: "clamp(1.5rem, 10vw, 7rem)", top: "clamp(2rem, 13vw, 7rem)" }}>
          <Box component="img" src="/brand/yuyu-mark.svg" alt="" sx={{ width: { xs: 76, sm: 104 }, height: { xs: 76, sm: 104 }, display: "block", filter: "drop-shadow(0 18px 22px rgba(10,132,255,0.18))" }} />
        </motion.div>
        <Stack spacing={3} sx={{ position: "relative", zIndex: 1, maxWidth: { xs: "100%", md: 650 }, minHeight: "100%", justifyContent: "center" }}>
          <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: prefersReducedMotion ? 0 : 0.55 }}><Chip icon={<FavoriteBorderOutlinedIcon />} label="ABOUT YUYU" color="primary" variant="outlined" sx={{ fontWeight: 700, letterSpacing: "0.08em" }} /></motion.div>
          <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: prefersReducedMotion ? 0 : 0.65, delay: prefersReducedMotion ? 0 : 0.1 }}><Typography component="h1" variant="h1" sx={{ color: strongInk, fontSize: { xs: "2.65rem", sm: "4.2rem", md: "5rem" }, maxWidth: 650, fontWeight: 850, lineHeight: 0.98, letterSpacing: "-0.07em" }}>A small idea for <Box component="span" sx={{ background: isDark ? "linear-gradient(120deg, #7CF5B6, #B9AEFF)" : "linear-gradient(120deg, #087A5A, #6551C7 58%, #C45532)", backgroundClip: "text", WebkitBackgroundClip: "text", color: "transparent" }}>better gatherings.</Box></Typography></motion.div>
          <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: prefersReducedMotion ? 0 : 0.55, delay: prefersReducedMotion ? 0 : 0.23 }}><Typography color="text.secondary" sx={{ maxWidth: 500, fontSize: { xs: "1rem", md: "1.15rem" }, lineHeight: 1.7 }}>A story about the person behind Yuyu, the tools helping bring it to life, and the communities it is being made for.</Typography></motion.div>
          <motion.div initial={prefersReducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: prefersReducedMotion ? 0 : 0.5, delay: prefersReducedMotion ? 0 : 0.42 }}><Stack direction="row" spacing={1} sx={{ alignItems: "center", color: "text.secondary", pt: 1 }}><ArrowDownwardOutlinedIcon fontSize="small" /><Typography variant="body2" sx={{ fontWeight: 700 }}>Scroll to follow the story</Typography></Stack></motion.div>
        </Stack>
      </Paper>

      <Box ref={storyRef} sx={{ mt: { xs: 6, md: 10 }, pb: { xs: 2, md: 4 } }}>
        <Box sx={{ position: "relative", maxWidth: 760, mx: "auto" }}>
          <Box aria-hidden sx={{ position: "absolute", left: 19, top: 50, bottom: 58, width: 2, bgcolor: "divider" }} />
          <motion.div aria-hidden style={{ position: "absolute", left: 19, top: 50, bottom: 58, width: 2, background: "linear-gradient(#7CF5B6, #0A84FF, #B9AEFF)", scaleY: prefersReducedMotion ? 1 : progress, transformOrigin: "top" }} />
          {chapters.map((chapter, index) => {
          const Icon = chapter.icon;
          return (
            <Box key={chapter.number} sx={{ position: "relative", pl: 7, pb: { xs: 5, md: 8 } }}>
              <Box aria-hidden sx={{ position: "absolute", zIndex: 2, left: 9, top: 40, width: 22, height: 22, borderRadius: "50%", border: "4px solid", borderColor: "background.default", bgcolor: "primary.main", boxShadow: "0 0 0 4px rgba(10,132,255,0.16)" }} />
              <Box aria-hidden sx={{ position: "absolute", left: 30, right: "auto", top: 50, width: 26, height: 2, bgcolor: "divider" }} />
              <motion.div initial={prefersReducedMotion ? false : "hidden"} whileInView="visible" viewport={{ once: true, amount: 0.35 }} variants={revealVariants} style={{ width: "100%", display: "flex", justifyContent: "center" }}>
                <Paper variant="outlined" sx={{ width: "100%", p: { xs: 3, sm: 4 }, borderRadius: 4, background: `linear-gradient(135deg, ${isDark ? chapter.darkAccent : chapter.lightAccent}, ${isDark ? "rgba(18,18,20,0.88)" : "rgba(255,255,255,0.92)"} 62%)`, borderColor: isDark ? "divider" : "rgba(75,92,118,0.15)", boxShadow: isDark ? "0 14px 35px rgba(0,0,0,0.18)" : "0 18px 45px rgba(53,70,99,0.11)" }}>
                  <Stack spacing={2.25}>
                    <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                      <Typography variant="overline" color="primary" sx={{ fontWeight: 800, letterSpacing: "0.13em" }}>{chapter.number} · {chapter.eyebrow}</Typography>
                      <motion.div animate={prefersReducedMotion ? undefined : { rotate: [0, -8, 6, 0] }} transition={{ duration: 4.5, repeat: Infinity, delay: index * 0.35, ease: "easeInOut" }}><Box sx={{ width: 46, height: 46, display: "grid", placeItems: "center", borderRadius: 2.5, bgcolor: "background.paper", color: "primary.main", border: 1, borderColor: "divider" }}><Icon /></Box></motion.div>
                    </Stack>
                    <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1.08, letterSpacing: "-0.05em" }}>{chapter.title}</Typography>
                    <Typography color="text.secondary" sx={{ lineHeight: 1.7 }}>{chapter.body}</Typography>
                    <Typography sx={{ pl: 2, borderLeft: "3px solid", borderColor: "primary.main", fontStyle: "italic", lineHeight: 1.65 }}>{chapter.detail}</Typography>
                  </Stack>
                </Paper>
              </motion.div>
            </Box>
          );
          })}
        </Box>
      </Box>

      <Box component="section" aria-labelledby="about-principles-title" sx={{ mt: { xs: 2, md: 4 }, mb: { xs: 6, md: 10 } }}>
        <Stack spacing={1} sx={{ maxWidth: 700, mb: { xs: 3, md: 4 } }}>
          <Typography variant="overline" sx={{ color: isDark ? "#7CF5B6" : "#087A5A", fontWeight: 800, letterSpacing: "0.13em" }}>WHAT YUYU STANDS FOR</Typography>
          <Typography id="about-principles-title" variant="h2" sx={{ color: strongInk, fontSize: { xs: "2rem", md: "3rem" }, fontWeight: 850, letterSpacing: "-0.055em" }}>A few principles, held on purpose.</Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 620, lineHeight: 1.7 }}>These are not extras to add later. They shape how Yuyu is designed, built, and operated today.</Typography>
        </Stack>
        <Grid container spacing={2.5}>
          {principles.map((principle, index) => {
            const Icon = principle.icon;
            return (
              <Grid key={principle.title} size={{ xs: 12, sm: 6 }}>
                <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.25 }} transition={{ duration: prefersReducedMotion ? 0 : 0.4, delay: prefersReducedMotion ? 0 : index * 0.06 }} style={{ height: "100%" }}>
                  <Paper variant="outlined" sx={{ height: "100%", p: { xs: 3, md: 3.5 }, borderRadius: 4, background: isDark ? "linear-gradient(145deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))" : `linear-gradient(145deg, ${principle.surface}, rgba(255,255,255,0.94) 58%)`, borderColor: isDark ? "divider" : "rgba(75,92,118,0.14)", transition: "transform 180ms ease, box-shadow 180ms ease", "&:hover": { transform: "translateY(-4px)", boxShadow: isDark ? "0 18px 42px rgba(0,0,0,0.2)" : "0 20px 46px rgba(53,70,99,0.13)" } }}>
                    <Stack spacing={2}>
                      <Box sx={{ width: 50, height: 50, display: "grid", placeItems: "center", borderRadius: 3, color: isDark ? "text.primary" : principle.color, bgcolor: isDark ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.72)", border: "1px solid", borderColor: isDark ? "divider" : "rgba(255,255,255,0.9)" }}><Icon /></Box>
                      <Typography variant="h5" sx={{ color: strongInk, fontWeight: 800 }}>{principle.title}</Typography>
                      <Typography color="text.secondary" sx={{ lineHeight: 1.65 }}>{principle.body}</Typography>
                    </Stack>
                  </Paper>
                </motion.div>
              </Grid>
            );
          })}
        </Grid>
      </Box>

      <Paper component="section" variant="outlined" sx={{ mb: { xs: 6, md: 10 }, position: "relative", overflow: "hidden", p: { xs: 3.5, sm: 5 }, borderRadius: 4, color: isDark ? "text.primary" : "#172238", background: isDark ? "linear-gradient(125deg, rgba(117,100,216,0.2), rgba(22,133,92,0.14))" : "linear-gradient(125deg, #E9E2FF 0%, #E4F8EE 52%, #FFE9DB 100%)", borderColor: isDark ? "divider" : "rgba(94,82,145,0.16)" }}>
        <Box aria-hidden sx={{ position: "absolute", width: 220, height: 220, borderRadius: "50%", right: -70, bottom: -120, bgcolor: isDark ? "rgba(124,245,182,0.08)" : "rgba(255,255,255,0.46)" }} />
        <Grid container spacing={4} sx={{ position: "relative", alignItems: "center" }}>
          <Grid size={{ xs: 12, md: 5 }}>
            <Typography variant="overline" sx={{ color: isDark ? "#B9AEFF" : "#5E4DB2", fontWeight: 800, letterSpacing: "0.12em" }}>ROOM FOR MANY KINDS OF COMMUNITY</Typography>
            <Typography variant="h3" sx={{ mt: 1, fontWeight: 850, letterSpacing: "-0.05em" }}>Made for gatherings with a reason to exist.</Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 7 }}>
            <Typography sx={{ mb: 2.5, lineHeight: 1.7, color: isDark ? "text.secondary" : "rgba(23,34,56,0.74)" }}>Yuyu is for organisers who care about the room they are creating—not monetising the doorway. Big or small, one-time or recurring, the gathering stays at the centre.</Typography>
            <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", gap: 1 }}>{gatheringTypes.map((type) => <Chip key={type} label={type} sx={{ bgcolor: isDark ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.66)", color: "inherit", border: "1px solid", borderColor: isDark ? "divider" : "rgba(94,82,145,0.14)", fontWeight: 700 }} />)}</Stack>
          </Grid>
        </Grid>
      </Paper>

      <motion.div initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: prefersReducedMotion ? 0 : 0.5 }}>
        <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 4, textAlign: { xs: "left", sm: "center" }, background: isDark ? "radial-gradient(circle at 50% 0%, rgba(124,245,182,0.18), transparent 64%), linear-gradient(135deg, rgba(10,132,255,0.08), rgba(185,174,255,0.1))" : "radial-gradient(circle at 50% 0%, rgba(100,224,164,0.42), transparent 62%), linear-gradient(135deg, #F0F7FF, #F3ECFF 55%, #FFF1E8)", borderColor: isDark ? "divider" : "rgba(75,92,118,0.16)", boxShadow: isDark ? "none" : "0 22px 58px rgba(53,70,99,0.12)" }}>
          <Stack spacing={2} sx={{ alignItems: { xs: "flex-start", sm: "center" } }}>
            <Typography variant="overline" color="primary" sx={{ fontWeight: 800, letterSpacing: "0.12em" }}>THE NEXT CHAPTER</Typography>
            <Typography variant="h3" sx={{ maxWidth: 620, fontWeight: 800, letterSpacing: "-0.05em" }}>The story gets better with people in the room.</Typography>
            <Typography color="text.secondary" sx={{ maxWidth: 580, lineHeight: 1.65 }}>Explore the gatherings being hosted with Yuyu—or start shaping one of your own.</Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ width: { xs: "100%", sm: "auto" } }}><Button component={Link} href="/discover" variant="contained" size="large" endIcon={<ArrowForwardIcon />}>Explore events</Button><Button component="a" href="https://abhiramnj.com" target="_blank" rel="noreferrer" variant="outlined" size="large" endIcon={<OpenInNewOutlinedIcon />}>Visit Abhiram&apos;s portfolio</Button></Stack>
          </Stack>
        </Paper>
      </motion.div>
    </Box>
  );
}
