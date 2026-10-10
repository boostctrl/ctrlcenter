import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NotesWidget from "./NotesWidget";

// A note's headings continue the page's outline without skipping a level.
describe("NotesWidget headings", () => {
  it("puts the note's top heading right under the card title", () => {
    render(<NotesWidget title="Notes" content={"## This week\n### Monday\ntext"} />);
    expect(screen.getByRole("heading", { level: 2, name: "Notes" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "This week" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 4, name: "Monday" })).toBeTruthy();
  });

  it("starts at h2 when the title is hidden, and keeps # at the top", () => {
    render(<NotesWidget title="Notes" showTitle={false} content={"# Plan\n## Detail"} />);
    expect(screen.getByRole("heading", { level: 2, name: "Plan" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 3, name: "Detail" })).toBeTruthy();
  });
});
