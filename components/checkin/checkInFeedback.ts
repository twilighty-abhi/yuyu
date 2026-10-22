/** A short beep and buzz for a successful scan, shared by the entry and list desks. */
export function playSuccessFeedback() {
  if (typeof window === "undefined") return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.value = 0.08;
    o.start();
    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 120);
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate(40);
  }
}

/** A low double buzz for a refused scan (ineligible, wrong event, archived list). */
export function playRefusedFeedback() {
  if (typeof navigator !== "undefined" && navigator.vibrate) {
    navigator.vibrate([60, 40, 60]);
  }
}
