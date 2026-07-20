import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import ContextProvider from "@/context";
import { AppShell } from "@/components/shell/AppShell";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vulcra — Forge dollars from your XRP",
  description:
    "A CDP stablecoin on Flare. Lock FXRP, mint vUSD, and mint natively from XRPL.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookies = (await headers()).get("cookie");

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ContextProvider cookies={cookies}>
          <AppShell>{children}</AppShell>
        </ContextProvider>
      </body>
    </html>
  );
}
