import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Automation Hub",
  description: "Admin and user portal for n8n workflow management",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
