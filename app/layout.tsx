import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Artha — Research Desk",
  description: "Institutional-grade equity research platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
