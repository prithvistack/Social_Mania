import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: { default: "Quiet", template: "%s · Quiet" },
  description: "A distraction-free, reverse-chronological feed of your YouTube subscriptions.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0c",
  width: "device-width",
  initialScale: 1,
};

// Runs before first paint so neither the theme nor theatre mode flashes
// in the wrong state on load.
const THEME_BOOTSTRAP = `
try {
  var t = localStorage.getItem('quiet-theme');
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
  if (localStorage.getItem('quiet-theatre') === '1') document.documentElement.setAttribute('data-theatre', '');
} catch (e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-screen bg-canvas text-ink antialiased">
        <Header />
        <main className="mx-auto w-full max-w-6xl px-5 pb-32 sm:px-8">{children}</main>
      </body>
    </html>
  );
}
