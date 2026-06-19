"use client";

import type { InputHTMLAttributes, ButtonHTMLAttributes } from "react";

export function TextField({
  label,
  ...props
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-white/50">{label}</span>
      <input
        {...props}
        className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white placeholder-white/30 outline-none transition-colors focus:border-violet-400/60"
      />
    </label>
  );
}

type ButtonVariant = "primary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: { variant?: ButtonVariant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<ButtonVariant, string> = {
    primary: "bg-gradient-to-r from-violet-500 to-cyan-400 text-black hover:opacity-90",
    ghost: "border border-white/10 bg-white/5 text-white/80 hover:bg-white/10",
    danger: "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
  };
  return <button {...props} className={`${base} ${variants[variant]} ${className}`} />;
}
