"use client";

import { useEffect } from "react";
import { useSetBoardTheme, type DefaultTheme } from "./PrefsProvider";

// Hands the board's own theme (#337) to PrefsProvider while this board is
// open, and takes it back on the way out — so a client-side move between
// boards repaints, where the root layout (which already painted this theme
// for the first load, from the request path) doesn't re-render. `theme` is
// null for a board without one, which the provider reads as the site's.
export default function BoardTheme({ theme }: { theme: DefaultTheme | null }) {
  const setBoardTheme = useSetBoardTheme();
  useEffect(() => {
    setBoardTheme(theme);
    return () => setBoardTheme(null);
  }, [theme, setBoardTheme]);
  return null;
}
