import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteHeader } from "@/components/layout/site-header";
import { SiteFooter } from "@/components/layout/site-footer";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

// Read directly rather than via lib/env: the root layout renders for every
// route, so it must not pull in unrelated (e.g. Supabase) env validation just
// to build a metadata URL. Falls back the same way lib/env's schema does.
const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
const description = "Track, rate and discover the games you play.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Savepoint",
    template: "%s · Savepoint",
  },
  description,
  applicationName: "Savepoint",
  openGraph: {
    title: "Savepoint",
    description,
    siteName: "Savepoint",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Savepoint",
    description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
