import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "MediTrack", template: "%s · MediTrack" },
  description: "Medicine inventory and expiry management system",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#137f6f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
