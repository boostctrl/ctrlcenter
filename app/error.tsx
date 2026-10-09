"use client";

import { useEffect } from "react";
import Link from "next/link";
import { buttonClasses } from "@/lib/buttons";

// The error boundary for every page: an unexpected server or render error
// shows this — in the site's own styling, with a retry — rather than Next's
// bare error screen. The detail stays in the server log (and the browser
// console); `digest` is the id Next logs it under, shown so a report can be
// matched to the log line.
export default function ErrorPage({
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
    <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 pt-12 pb-24 sm:px-10 lg:pt-16">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="text-ink-50">
        This page hit an unexpected error. Trying again often helps; if it
        keeps happening, the server log has the details
        {error.digest ? ` (look for ${error.digest})` : ""}.
      </p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={reset} className={buttonClasses("primary")}>
          Try again
        </button>
        <Link href="/" className={buttonClasses("ghost")}>
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
