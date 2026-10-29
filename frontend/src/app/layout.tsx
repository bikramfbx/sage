import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Instrument_Sans,
  Cinzel,
  Space_Mono,
} from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSans = Instrument_Sans({
  weight: ["500", "600"],
  variable: "--font-instrument",
  subsets: ["latin"],
});

const cinzel = Cinzel({
  weight: ["400", "700"],
  variable: "--font-cinzel",
  subsets: ["latin"],
});

const spaceMono = Space_Mono({
  weight: ["400", "700"],
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SAGE — Dashboard",
  description: "Student Assistant for Growth and Education",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSans.variable} ${cinzel.variable} ${spaceMono.variable} h-full antialiased dark`}
    >
      <body className="min-h-full flex flex-col bg-zinc-950 text-zinc-100 font-sans">{children}</body>
    </html>
  );
}
