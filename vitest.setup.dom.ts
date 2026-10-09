// Setup for the jsdom test project (vitest.config.mts). Testing Library only
// auto-unmounts between tests when vitest globals are on; they aren't here.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
