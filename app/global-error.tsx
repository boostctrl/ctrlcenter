"use client";

import { useEffect } from "react";
import "./globals.css";

// Last-resort error screen for failures in the root layout itself — most
// often a config.yaml that can't be read or parsed, since the layout reads
// settings on every page. It replaces the layout (so it renders its own
// <html>/<body>) and can't use the site's theme or fonts, only the default
// styling from globals.css. Page-level errors get app/error.tsx instead.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center gap-6 px-6 py-12">
          <h1 className="text-3xl font-bold">CtrlCenter couldn&apos;t load</h1>
          <p className="text-ink-60">
            Something failed before any page could render — often a problem
            reading the config file (config.yaml). The server log has the
            details{error.digest ? ` (look for ${error.digest})` : ""}.
          </p>
          <div>
            <button
              type="button"
              onClick={reset}
              className="btn-accent rounded-[var(--control-radius)] px-4 py-2 text-sm font-medium"
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
