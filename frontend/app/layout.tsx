import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chef in My Pocket",
  description: "Your personal AI chef powered by Rohlík recipes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
