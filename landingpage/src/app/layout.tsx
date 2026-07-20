import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SITE } from "@/lib/content";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const ogTitle = "Vulcra — Forge dollars from your XRP";

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: ogTitle,
    template: "%s — Vulcra",
  },
  description: SITE.description,
  applicationName: "Vulcra",
  keywords: [
    "Vulcra",
    "Flare",
    "FXRP",
    "XRP",
    "CDP",
    "stablecoin",
    "vUSD",
    "DeFi",
    "FAssets",
    "Confidential Compute",
  ],
  authors: [{ name: "Vulcra" }],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: SITE.url,
    siteName: "Vulcra",
    title: ogTitle,
    description: SITE.description,
  },
  twitter: {
    card: "summary_large_image",
    title: ogTitle,
    description: SITE.description,
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#17120d",
  colorScheme: "dark light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
