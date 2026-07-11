import { NextResponse } from "next/server";
import { NotFoundError } from "./config";
import { log, errorReason } from "./log";

// Map a thrown error from an admin item mutator to an HTTP response. A genuine
// missing item is the only 404; every other throw — a full disk, a permissions
// problem, failed validation on save — is logged and reported as a 500, rather
// than mislabelled "Not found" for an item that's plainly still in the list.
export function itemMutationErrorResponse(error: unknown): NextResponse {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  log.error("admin item write failed", { reason: errorReason(error) });
  return NextResponse.json({ error: "Failed to save" }, { status: 500 });
}
