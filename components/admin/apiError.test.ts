import { describe, it, expect } from "vitest";
import { apiErrorMessage } from "./apiError";

describe("apiErrorMessage", () => {
  it("returns a plain string error as-is", () => {
    expect(apiErrorMessage({ error: "Invalid password" }, "fallback")).toBe(
      "Invalid password"
    );
  });

  it("flattens Zod field errors into a readable message", () => {
    const data = {
      error: { formErrors: [], fieldErrors: { url: ["Invalid url"] } },
    };
    expect(apiErrorMessage(data, "fallback")).toBe("Invalid url");
  });

  it("joins form and field errors", () => {
    const data = {
      error: {
        formErrors: ["Top-level problem"],
        fieldErrors: { name: ["Required"], url: ["Invalid url"] },
      },
    };
    expect(apiErrorMessage(data, "fallback")).toBe(
      "Top-level problem, Required, Invalid url"
    );
  });

  it("falls back when there is no usable error", () => {
    expect(apiErrorMessage(null, "Something went wrong")).toBe(
      "Something went wrong"
    );
    expect(apiErrorMessage({}, "Something went wrong")).toBe(
      "Something went wrong"
    );
    expect(
      apiErrorMessage({ error: { formErrors: [], fieldErrors: {} } }, "fb")
    ).toBe("fb");
  });
});
