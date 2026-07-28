import type { Metadata } from "next";
import { Raleway } from "next/font/google";
import "./globals.css";

const raleway = Raleway({
  variable: "--font-raleway",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Klinpi — Model Routing for Modern Engineering Teams",
  description:
    "Klinpi is an intelligent routing layer that helps engineering teams manage AI models across multiple providers with reliability, observability, and complete control.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${raleway.variable} h-full antialiased`}>
      <body className="relative min-h-full flex flex-col bg-background font-sans text-foreground overflow-x-hidden">
        <div
          className="pointer-events-none fixed inset-0 -z-10 animate-pulse-glow"
          style={{
            background:
              "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(255,255,255,0.06) 0%, transparent 100%)",
          }}
        />
        <div
          className="pointer-events-none fixed inset-0 -z-10 opacity-[0.015]"
          style={{
            backgroundImage:
              "radial-gradient(circle, rgba(255,255,255,0.5) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        {children}
      </body>
    </html>
  );
}