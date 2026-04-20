import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { auth } from "@/lib/auth";
import { Providers } from "@/components/providers";
import { AppBarNav } from "@/components/nav/AppBarNav";
import Container from "@mui/material/Container";
import Box from "@mui/material/Box";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <Providers session={session}>
          <AppBarNav />
          <Box component="main" sx={{ flex: 1, py: 3 }}>
            <Container maxWidth="lg">{children}</Container>
          </Box>
        </Providers>
      </body>
    </html>
  );
}
