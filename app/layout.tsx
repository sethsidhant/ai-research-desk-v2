import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Noesis — Know before you trade.",
  description: "Know before you trade.",
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
