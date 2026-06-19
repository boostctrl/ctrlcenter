"use client";

import { useState } from "react";
import { resolveIconUrl } from "@/lib/icons";

type IconProps = {
  icon: string;
  name: string;
  size?: number;
  className?: string;
};

export default function Icon({ icon, name, size = 28, className = "" }: IconProps) {
  const [failed, setFailed] = useState(false);
  const url = resolveIconUrl(icon);

  if (!url || failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg bg-white/10 text-white/70 ${className}`}
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
