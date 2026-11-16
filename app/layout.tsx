import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Master Task Manager",
  description: "A private command center for personal and work priorities.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
