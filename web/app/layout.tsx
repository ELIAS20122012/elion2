import type { Metadata, Viewport } from "next";
import { Nav } from "./Nav";
import { Toaster } from "./ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elias OS",
  description: "پنل Elias OS",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Elias OS", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1014" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <Nav />
        <main className="main">{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
