export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateRuntimeEnvironment } = await import("@/lib/env");
    validateRuntimeEnvironment();
  }
}
