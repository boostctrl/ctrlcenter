import Link from "next/link";

// The standard "return to the dashboard" control. It leads the PageNav strip
// on every page outside the home dashboard (label "Dashboard" there), and
// stands alone on the admin login screen — an auth gate wants a way out, not
// a menu — so the affordance — icon, label, hover treatment — is identical
// everywhere and no page is left without a way home. The arrow is a drawn
// glyph (not the "←" character) so it renders the same under every selectable
// font.
export default function BackHome({
  className = "",
  label = "Back to dashboard",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <Link
      href="/"
      className={`inline-flex items-center gap-1.5 text-sm text-fg/50 transition-colors hover:text-fg/80 ${className}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M19 12H5" />
        <path d="m12 19-7-7 7-7" />
      </svg>
      {label}
    </Link>
  );
}
