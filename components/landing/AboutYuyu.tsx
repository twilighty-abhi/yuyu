"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion, useScroll, useSpring, type Variants } from "framer-motion";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ArrowDownwardOutlinedIcon from "@mui/icons-material/ArrowDownwardOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import FavoriteBorderOutlinedIcon from "@mui/icons-material/FavoriteBorderOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import PersonOutlineOutlinedIcon from "@mui/icons-material/PersonOutlineOutlined";
import RocketLaunchOutlinedIcon from "@mui/icons-material/RocketLaunchOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

const chapters = [
  { number: "01", eyebrow: "The person", title: "Hi, I’m Abhiram N J.", body: "I’m building Yuyu as a calmer way to bring people together. The starting point is simple: make free events easier to organise without turning every gathering into a transaction.", detail: "Because the best events are often the ones that begin with someone deciding there should be room for people to meet.", icon: PersonOutlineOutlinedIcon, accent: "rgba(124,245,182,0.16)" },
  { number: "02", eyebrow: "The craft", title: "Human intent, AI-assisted making.", body: "Yuyu is shaped by Abhiram’s product decisions and built with the help of AI tools. They help explore ideas and accelerate implementation, while the care, trade-offs, and responsibility stay human.", detail: "The point is not to automate the thoughtfulness out of building—it is to spend more time on the details that make the product kinder and more useful.", icon: AutoAwesomeOutlinedIcon, accent: "rgba(185,174,255,0.18)" },
  { number: "03", eyebrow: "The invitation", title: "Still becoming, alongside real communities.", body: "Yuyu is self-hosted, privacy-minded, and designed to grow with the people using it for workshops, meetups, and meaningful gatherings.", detail: "It is a work in progress—one that stays grounded in the simple belief that software should make hosting feel more human, not less.", icon: RocketLaunchOutlinedIcon, accent: "rgba(10,132,255,0.16)" },
] as const;

const revealVariants: Variants = {
  hidden: { opacity: 0, y: 32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

export function AboutYuyu() {
  const storyRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: storyRef, offset: ["start 78%", "end 72%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 100, damping: 28, mass: 0.35 });

  return (
    <Box sx={{ maxWidth: 1040, mx: "auto", py: { xs: 2, md: 5 }, pb: { xs: 7, md: 12 } }}>
      <Paper variant="outlined" sx={{ position: "relative", minHeight: { xs: 500, md: 570 }, overflow: "hidden", p: { xs: 3, sm: 5, md: 7 }, borderRadius: 5, background: "radial-gradient(circle at 82% 18%, rgba(185,174,255,0.25), transparent 28%), radial-gradient(circle at 15% 85%, rgba(124,245,182,0.2), transparent 34%), linear-gradient(145deg, rgba(10,132,255,0.1), transparent 68%)" }}>
        <motion.div aria-hidden animate={prefersReducedMotion ? undefined : { rotate: 360 }} transition={{ duration: 32, repeat: Infinity, ease: "linear" }} style={{ position: "absolute", width: 360, height: 360, border: "1px dashed rgba(10,132,255,0.28)", borderRadius: "50%", right: -110, top: -110 }} />
        <motion.div aria-hidden animate={prefersReducedMotion ? undefined : { y: [0, -12, 0], rotate: [0, 5, 0] }} transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }} style={{ position: "absolute", right: "clamp(1.5rem, 10vw, 7rem)", top: "clamp(2rem, 13vw, 7rem)" }}>
          <Box component="img" src="/brand/yuyu-mark.svg" alt="" sx={{ width: { xs: 76, sm: 104 }, height: { xs: 76, sm: 104 }, display: "block", filter: "drop-shadow(0 18px 22px rgba(10,132,255,0.18))" }} />
        </motion.div>
        <Stack spacing={3} sx={{ position: "relative", zIndex: 1, maxWidth: { xs: "100%", md: 650 }, minHeight: "100%", justifyContent: "center" }}>
          <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: prefersReducedMotion ? 0 : 0.55 }}><Chip icon={<FavoriteBorderOutlinedIcon />} label="ABOUT YUYU" color="primary" variant="outlined" sx={{ fontWeight: 700, letterSpacing: "0.08em" }} /></motion.div>
          <motion.div initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: prefersReducedMotion ? 0 : 0.65, delay: prefersReducedMotion ? 0 : 0.1 }}><Typography component="h1" variant="h1" sx={{ fontSize: { xs: "2.65rem", sm: "4.2rem", md: "5rem" }, maxWidth: 650, fontWeight: 850, lineHeight: 0.98, letterSpacing: "-0.07em" }}>A small idea for better gatherings.</Typography></motion.div>
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
                <Paper variant="outlined" sx={{ width: "100%", p: { xs: 3, sm: 4 }, borderRadius: 4, background: `linear-gradient(135deg, ${chapter.accent}, transparent 58%)`, boxShadow: "0 14px 35px rgba(0,0,0,0.08)" }}>
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

      <motion.div initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.97 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: prefersReducedMotion ? 0 : 0.5 }}>
        <Paper variant="outlined" sx={{ p: { xs: 3.5, sm: 5 }, borderRadius: 4, textAlign: { xs: "left", sm: "center" }, background: "radial-gradient(circle at 50% 0%, rgba(124,245,182,0.18), transparent 64%), linear-gradient(135deg, rgba(10,132,255,0.08), rgba(185,174,255,0.1))" }}>
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
