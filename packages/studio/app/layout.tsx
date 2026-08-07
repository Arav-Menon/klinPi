import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800", "900"],
});

export const metadata: Metadata = {
  title: "Klinpi — The Intelligent Routing Layer for AI Agents",
  description:
    "Klinpi intelligently routes every LLM request to the right model, balancing quality, speed and cost automatically.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="relative min-h-full bg-background font-sans text-foreground overflow-x-hidden">
        {/* Gradient layers */}
        <div className="pointer-events-none fixed inset-0 -z-10 bg-gradient-primary" />
        <div className="pointer-events-none fixed inset-0 -z-10 bg-gradient-secondary" />
        {/* Grid overlay */}
        <div className="pointer-events-none fixed inset-0 -z-10 bg-grid" />
        {/* Noise texture */}
        <div className="pointer-events-none fixed inset-0 -z-10 bg-noise opacity-50" />
        {children}
      </body>
    </html>
  );
}
