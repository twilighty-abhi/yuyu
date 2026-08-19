import type { Metadata } from "next";
import "@/lib/env";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import "./globals.css";
import { auth } from "@/lib/auth";
import { Providers } from "@/components/providers";
import { AppBarNav } from "@/components/nav/AppBarNav";
import { AppFooter } from "@/components/nav/AppFooter";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";

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
  const session = await auth();

  return (
    <html lang="en">
      <body style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
        <AppRouterCacheProvider options={{ key: "mui" }}>
          <Providers session={session}>
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
