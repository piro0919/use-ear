import { Analytics } from "@vercel/analytics/next";
import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import type { ReactNode } from "react";
import { SerwistProvider } from "../lib/client";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* 見出しの書体。9件が同じ字面だと、並んだときに見分けが付かない */
const display = Sora({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["700"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://use-ear.kkweb.io"),
  alternates: { canonical: "/" },
  applicationName: "useEar",
  title: "useEar - Wake Word Detection",
  description: "React hooks for wake word detection using Web Speech API",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "useEar",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#18181b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased ${display.variable}`}
      >
        <SerwistProvider swUrl="/serwist/sw.js">{children}</SerwistProvider>
        <Analytics />
      </body>
    </html>
  );
}
