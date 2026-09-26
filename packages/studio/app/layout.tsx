import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import "lenis/dist/lenis.css";
import SmoothScroll from "./components/smooth-scroll";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Klinpi | Agent for your repositories",
  description:
    "Connect a GitHub repository, hand Klinpi a task, and the agent reads the code, edits files and runs the work in an isolated cloud sandbox streaming every step back to you.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="relative min-h-full bg-background font-sans text-foreground">
        <a href="#main" className="skip-link">
          Skip to content
        </a>
        <div className="pointer-events-none fixed inset-0 -z-10 bg-gradient-primary" />
        <div className="pointer-events-none fixed inset-0 -z-10 bg-grid" />
        <div className="pointer-events-none fixed inset-0 -z-10 bg-noise" />
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
