import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "Spatial Tissue Region Annotator | M20 Genomics",
  description: "Client-only tool for marking tissue regions on spatial transcriptomics slides.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={spaceGrotesk.variable}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
