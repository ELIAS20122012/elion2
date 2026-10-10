import type { Metadata, Viewport } from "next";
import { Nav } from "./Nav";
import { Topbar } from "./Topbar";
import { Toaster } from "./ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Elion",
  description: "Elion — سیستم‌عامل ایجنتیک شخصی",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "Elion", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#07080c", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500;600;700;800&family=Orbitron:wght@500;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Nav />
        <div className="shell">
          <Topbar />
          <main className="main">{children}</main>
        </div>
        <Toaster />
      </body>
    </html>
  );
}
