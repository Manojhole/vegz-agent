import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vegz agent portal",
  description: "Vegz local produce and grocery platform",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
