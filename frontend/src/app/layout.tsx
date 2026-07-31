import type { Metadata } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import "./globals.css";
import ContextProvider from "@/context";
import { BranchProvider } from "@/context/branch";
import { AppShell } from "@/components/shell/AppShell";

const epilogue = localFont({
  src: "../../public/fonts/Epilogue-VariableFont_wght.ttf",
  variable: "--font-epilogue",
  weight: "100 900",
  display: "swap",
});

const dmSans = localFont({
  src: "../../public/fonts/DMSans-VariableFont_opsz,wght.ttf",
  variable: "--font-dm-sans",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vulcra — borrow vUSD on Flare · Coston2",
  description:
    "Borrow vUSD against FXRP and FLR collateral — a multi-collateral CDP stablecoin on Flare Coston2, with XRPL-native minting.",
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
      className={`${epilogue.variable} ${dmSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col overflow-x-clip">
        <ContextProvider cookies={cookies}>
          <BranchProvider>
            <AppShell>{children}</AppShell>
          </BranchProvider>
        </ContextProvider>
      </body>
    </html>
  );
}
