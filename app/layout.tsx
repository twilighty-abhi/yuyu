import type { Metadata } from "next";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppBarNav } from "@/components/nav/AppBarNav";
import { AppFooter } from "@/components/nav/AppFooter";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";
import { connection } from "next/server";

export const metadata: Metadata = {
  title: {
    default: "Yuyu — Events",
    template: "%s · Yuyu",
  },
  description: "Create organisations, publish events, and collect RSVPs.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A per-request CSP nonce is injected by proxy.ts. Waiting for the incoming
  // request lets Next.js attach that nonce to every framework script.
  await connection();

  return (
    <html lang="en">
      <body style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <AppRouterCacheProvider options={{ key: "mui" }}>
          <Providers>
            <AppBarNav />
            <Box component="main" sx={{ flex: 1, py: 3 }}>
              <Container maxWidth="lg">{children}</Container>
            </Box>
            <AppFooter />
          </Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
