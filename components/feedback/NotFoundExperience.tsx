"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring, type Variants } from "framer-motion";
import { useRouter } from "next/navigation";
import ArrowBackOutlinedIcon from "@mui/icons-material/ArrowBackOutlined";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ExploreOutlinedIcon from "@mui/icons-material/ExploreOutlined";
import SearchOffOutlinedIcon from "@mui/icons-material/SearchOffOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.32, ease: "easeOut" } },
};

const contentVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: "easeOut" },
  },
};

function CursorEyes({ prefersReducedMotion }: { prefersReducedMotion: boolean | null }) {
  const eyesRef = useRef<HTMLDivElement>(null);
  const [blinking, setBlinking] = useState(false);
  const gazeX = useMotionValue(0);
  const gazeY = useMotionValue(0);
  const pupilX = useSpring(gazeX, { stiffness: 260, damping: 20, mass: 0.35 });
  const pupilY = useSpring(gazeY, { stiffness: 260, damping: 20, mass: 0.35 });

  useEffect(() => {
    const followCursor = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== "mouse" || !eyesRef.current) return;
      const bounds = eyesRef.current.getBoundingClientRect();
      const deltaX = event.clientX - (bounds.left + bounds.width / 2);
      const deltaY = event.clientY - (bounds.top + bounds.height / 2);
      const distance = Math.hypot(deltaX, deltaY) || 1;
      const amount = Math.min(17, distance / 8);
      gazeX.set((deltaX / distance) * amount);
      gazeY.set((deltaY / distance) * amount);
    };

    window.addEventListener("pointermove", followCursor);
    return () => window.removeEventListener("pointermove", followCursor);
  }, [gazeX, gazeY]);

  useEffect(() => {
    if (prefersReducedMotion) return;
    let blinkStart: number | undefined;
    let blinkEnd: number | undefined;

    const scheduleBlink = () => {
      blinkStart = window.setTimeout(() => {
        setBlinking(true);
        blinkEnd = window.setTimeout(() => {
          setBlinking(false);
          scheduleBlink();
        }, 130);
      }, 3_600 + Math.random() * 3_400);
    };

    scheduleBlink();
    return () => {
      if (blinkStart) window.clearTimeout(blinkStart);
      if (blinkEnd) window.clearTimeout(blinkEnd);
    };
  }, [prefersReducedMotion]);

  return (
    <Box
      ref={eyesRef}
      aria-hidden
      sx={{ display: { xs: "none", md: "flex" }, justifyContent: "center", gap: 2.5, pt: 0.25, opacity: 0.94 }}
    >
      {[0, 1].map((eye) => (
        <Box key={eye} sx={{ position: "relative", width: { xs: 82, sm: 98 }, height: { xs: 112, sm: 128 } }}>
          <Box sx={{ position: "absolute", top: 8, left: "50%", width: { xs: 60, sm: 72 }, height: 26, borderTop: "7px solid", borderColor: "text.primary", borderRadius: "50% 50% 0 0", transform: `translateX(-50%) rotate(${eye === 0 ? "-4deg" : "4deg"})` }} />
          <motion.div
            animate={prefersReducedMotion ? undefined : { scaleY: blinking ? 0.07 : 1 }}
            transition={{ duration: 0.09, ease: "easeInOut" }}
            style={{ position: "absolute", insetInline: 0, top: 35, display: "grid", placeItems: "center", transformOrigin: "center" }}
          >
            <Box sx={{ width: { xs: 76, sm: 90 }, height: { xs: 76, sm: 90 }, display: "grid", placeItems: "center", overflow: "hidden", border: "6px solid", borderColor: "text.primary", borderRadius: "50%", bgcolor: "background.paper", boxShadow: "inset 0 -5px 0 rgba(10,132,255,0.08), 0 8px 18px rgba(0,0,0,0.1)" }}>
              <motion.div style={{ x: pupilX, y: pupilY }}>
                <Box sx={{ position: "relative", width: { xs: 28, sm: 33 }, height: { xs: 28, sm: 33 }, borderRadius: "50%", bgcolor: "text.primary", boxShadow: "0 0 0 4px rgba(10,132,255,0.12)" }}>
                  <Box sx={{ position: "absolute", top: 5, left: 6, width: 7, height: 7, borderRadius: "50%", bgcolor: "background.paper", opacity: 0.92 }} />
                </Box>
              </motion.div>
            </Box>
          </motion.div>
        </Box>
      ))}
    </Box>
  );
}

export function NotFoundExperience() {
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const pointerX = useMotionValue(0);
  const pointerY = useMotionValue(0);
  const iconX = useSpring(pointerX, { stiffness: 260, damping: 18, mass: 0.45 });
  const iconY = useSpring(pointerY, { stiffness: 260, damping: 18, mass: 0.45 });

  const resetPointer = () => {
    pointerX.set(0);
    pointerY.set(0);
  };

  const followPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (prefersReducedMotion || event.pointerType !== "mouse") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pointerX.set(Math.max(-6, Math.min(6, (event.clientX - bounds.left - bounds.width / 2) / 8)));
    pointerY.set(Math.max(-6, Math.min(6, (event.clientY - bounds.top - bounds.height / 2) / 8)));
  };

  const goBackOrHome = () => {
    try {
      const hasSameOriginReferrer = document.referrer
        && new URL(document.referrer).origin === window.location.origin;
      if (hasSameOriginReferrer && window.history.length > 1) {
        router.back();
        return;
      }
    } catch {
      // A malformed referrer is treated like an unknown navigation source.
    }
    router.push("/");
  };

  return (
    <motion.div
      initial={prefersReducedMotion ? false : "hidden"}
      animate="visible"
      variants={cardVariants}
    >
      <Paper
        variant="outlined"
        sx={{
          position: "relative",
          overflow: "hidden",
          maxWidth: 680,
          mx: "auto",
          mt: { xs: 4, sm: 8 },
          mb: { xs: 1.5, sm: 2 },
          p: { xs: 3, sm: 6 },
          textAlign: "center",
          borderRadius: 5,
          background: "linear-gradient(145deg, rgba(10,132,255,0.12), transparent 42%, rgba(124,245,182,0.08))",
        }}
      >
        <Box aria-hidden sx={{ position: "absolute", width: 220, height: 220, borderRadius: "50%", right: -110, top: -120, bgcolor: "primary.main", opacity: 0.12, filter: "blur(8px)" }} />
        <Typography aria-hidden sx={{ position: "absolute", left: "50%", top: { xs: 16, sm: 4 }, transform: "translateX(-50%)", fontSize: { xs: "8rem", sm: "12rem" }, lineHeight: 0.85, fontWeight: 900, letterSpacing: "-0.12em", color: "text.primary", opacity: 0.035, userSelect: "none" }}>
          404
        </Typography>
        <Stack spacing={2.25} sx={{ position: "relative", alignItems: "center" }}>
          <motion.div variants={contentVariants}>
            <Box
              aria-hidden
              onPointerMove={followPointer}
              onPointerLeave={resetPointer}
              sx={{ position: "relative", width: 116, height: 116, display: "grid", placeItems: "center", touchAction: "manipulation" }}
            >
              <motion.div
                style={{ position: "absolute", inset: 4, borderRadius: "50%", border: "1px dashed", borderColor: "var(--mui-palette-primary-main)", opacity: 0.42 }}
                animate={prefersReducedMotion ? undefined : { rotate: 360 }}
                transition={prefersReducedMotion ? undefined : { duration: 16, repeat: Infinity, ease: "linear" }}
              />
              <motion.div
                style={{ position: "absolute", top: 1, right: 18, color: "#7CF5B6" }}
                animate={prefersReducedMotion ? undefined : { y: [0, -5, 0], rotate: [0, 12, 0], opacity: [0.65, 1, 0.65] }}
                transition={prefersReducedMotion ? undefined : { duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
              >
                <AutoAwesomeRoundedIcon sx={{ fontSize: 20 }} />
              </motion.div>
              <motion.div
                style={{ position: "absolute", bottom: 3, left: 13, color: "#B9AEFF" }}
                animate={prefersReducedMotion ? undefined : { y: [0, 4, 0], scale: [0.85, 1.15, 0.85], opacity: [0.55, 1, 0.55] }}
                transition={prefersReducedMotion ? undefined : { duration: 2.3, repeat: Infinity, ease: "easeInOut", delay: 0.3 }}
              >
                <AutoAwesomeRoundedIcon sx={{ fontSize: 15 }} />
              </motion.div>
              <motion.div
                animate={prefersReducedMotion ? undefined : { y: [0, -3, 0] }}
                transition={prefersReducedMotion ? undefined : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
              >
                <motion.div style={{ x: iconX, y: iconY }}>
                  <Box sx={{ width: 76, height: 76, display: "grid", placeItems: "center", borderRadius: "28px", bgcolor: "background.paper", border: 1, borderColor: "divider", boxShadow: "0 12px 28px rgba(0,0,0,0.14)" }}>
                    <SearchOffOutlinedIcon color="primary" sx={{ fontSize: 38 }} />
                  </Box>
                </motion.div>
              </motion.div>
            </Box>
          </motion.div>
          <motion.div variants={contentVariants}>
            <Stack spacing={0.75}>
              <Typography component="h1" variant="h3" sx={{ fontWeight: 750, letterSpacing: "-0.04em" }}>Page not found</Typography>
              <Typography color="text.secondary" sx={{ maxWidth: 410, mx: "auto" }}>This corner of Yuyu seems to have wandered off. The page may have moved or expired.</Typography>
            </Stack>
          </motion.div>
          <motion.div variants={contentVariants}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ width: { xs: "100%", sm: "auto" } }}>
              <motion.div whileHover={prefersReducedMotion ? undefined : { y: -2 }} whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}>
                <Button onClick={goBackOrHome} variant="contained" size="large" startIcon={<ArrowBackOutlinedIcon />} sx={{ minWidth: 150, width: { xs: "100%", sm: "auto" } }}>Go back</Button>
              </motion.div>
              <motion.div whileHover={prefersReducedMotion ? undefined : { y: -2 }} whileTap={prefersReducedMotion ? undefined : { scale: 0.98 }}>
                <Button href="/discover" variant="outlined" size="large" startIcon={<ExploreOutlinedIcon />} sx={{ minWidth: 150, width: { xs: "100%", sm: "auto" } }}>Discover events</Button>
              </motion.div>
            </Stack>
          </motion.div>
        </Stack>
      </Paper>
      <CursorEyes prefersReducedMotion={prefersReducedMotion} />
    </motion.div>
  );
}
