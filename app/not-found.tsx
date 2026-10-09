import type { Metadata } from "next";
import Link from "next/link";
import { getSiteConfig } from "@/lib/config";
import { buttonClasses } from "@/lib/buttons";
import { navPages } from "@/lib/nav";
import PageNav from "@/components/PageNav";

export const metadata: Metadata = { title: "Page not found" };

// The 404 for any unknown URL (and every notFound() call, e.g. an unknown
// status or Monitor detail id): the same subpage shell as the other pages, so
// a mistyped link lands somewhere that looks like this site and leads back,
// instead of Next's bare default.
export default async function NotFound() {
  const { settings, widgets } = await getSiteConfig();
  return (
    <main id="main-content" className="mx-auto flex min-h-screen w-full max-w-8xl flex-col gap-8 px-6 pt-12 pb-24 sm:px-10 lg:pt-16">
      <div>
        <PageNav current={null} {...navPages(settings, widgets)} />
        <h1 className="mt-3 text-3xl font-bold">Page not found</h1>
      </div>
      <p className="text-ink-50">
        There&apos;s nothing at this address. It may have moved, or the link may
        be mistyped.
      </p>
      <div>
        <Link href="/" className={buttonClasses("primary")}>
          Back to the dashboard
        </Link>
      </div>
    </main>
  );
}
