import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { getSettings } from "@/lib/config";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-jakarta",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSettings();
  return {
    title: settings.title || "Home",
    description: "Personal dashboard",
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full`}>
      <body className="relative min-h-full overflow-x-hidden antialiased">
        <div
          aria-hidden
          className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        >
          <div className="animate-float absolute -top-32 -left-32 h-96 w-96 rounded-full bg-violet-600/30 blur-3xl" />
          <div
            className="animate-float absolute top-1/3 -right-32 h-[28rem] w-[28rem] rounded-full bg-cyan-500/20 blur-3xl"
            style={{ animationDelay: "4s" }}
          />
          <div
            className="animate-float absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-fuchsia-500/15 blur-3xl"
            style={{ animationDelay: "8s" }}
          />
        </div>
        {children}
      </body>
    </html>
  );
}
