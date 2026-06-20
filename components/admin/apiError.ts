// Turns an API error payload into a readable sentence. Handles both our plain
// `{ error: "message" }` responses and Zod's flattened validation shape
// (`{ error: { formErrors, fieldErrors } }`), so we never surface raw JSON.
export function apiErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object") {
      const { formErrors, fieldErrors } = err as {
        formErrors?: string[];
        fieldErrors?: Record<string, string[]>;
      };
      const messages = [
        ...(formErrors ?? []),
        ...Object.values(fieldErrors ?? {}).flat(),
      ].filter(Boolean);
      if (messages.length) return messages.join(", ");
    }
  }
  return fallback;
}
