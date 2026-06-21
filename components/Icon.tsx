"use client";

import { useEffect, useState } from "react";
import {
  loadIconMetadata,
  resolveIconUrl,
  resolveThemedIconUrl,
  type IconMetadata,
} from "@/lib/icons";
import { useVisitorPrefs } from "./PrefsProvider";

type IconProps = {
  icon: string;
  name: string;
  size?: number;
  className?: string;
};

// Icon metadata (light/dark variants) is fetched once for the whole page; share
// it across every Icon so they don't each refetch.
let sharedMetadata: IconMetadata | null = null;

export default function Icon({ icon, name, size = 28, className = "" }: IconProps) {
  const { surfaceIsLight } = useVisitorPrefs();
  const [metadata, setMetadata] = useState<IconMetadata | null>(sharedMetadata);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (sharedMetadata) return;
    let active = true;
    loadIconMetadata().then((m) => {
      sharedMetadata = m;
      if (active) setMetadata(m);
    });
    return () => {
      active = false;
    };
  }, []);

  // Prefer the variant that suits the current surface; before metadata loads (or
  // on failure) fall back to the base icon.
  const url = metadata
    ? resolveThemedIconUrl(icon, metadata, surfaceIsLight)
    : resolveIconUrl(icon);

  if (!url || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-fg/10 text-fg/70 ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.5 }}
        aria-hidden
      >
        {name.charAt(0).toUpperCase() || "?"}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- external, arbitrary-domain icon URLs aren't statically known for next/image
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      className={`object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
