import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "InfraWorks Modeling",
  description: "2D DWG + reports → InfraWorks-ready import package",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
