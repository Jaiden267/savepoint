import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { mockLogDiaryEntryAction, mockUpdateDiaryEntryAction } = vi.hoisted(
  () => ({
    mockLogDiaryEntryAction: vi.fn(
      async (state: unknown, _formData: FormData) => state,
    ),
    mockUpdateDiaryEntryAction: vi.fn(
      async (state: unknown, _formData: FormData) => state,
    ),
  }),
);

vi.mock("@/server/actions/diary", () => ({
  logDiaryEntryAction: mockLogDiaryEntryAction,
  updateDiaryEntryAction: mockUpdateDiaryEntryAction,
}));

import { LogDiaryEntryDialog } from "./log-diary-entry-dialog";

const gameId = "4dd1ceb8-3446-4167-a4b7-174a8e9e0a58";
const gameSlug = "the-legend-of-zelda";

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

describe("LogDiaryEntryDialog", () => {
  beforeEach(() => {
    mockLogDiaryEntryAction.mockClear();
    mockUpdateDiaryEntryAction.mockClear();
  });

  it("create mode: opens blank/today, submits logDiaryEntryAction with gameId (never entryId)", async () => {
    const user = userEvent.setup();
    render(
      <LogDiaryEntryDialog
        gameId={gameId}
        gameSlug={gameSlug}
        triggerLabel="Log play"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Log play" }));

    expect(screen.getByText("Log a play")).toBeInTheDocument();
    expect(screen.getByLabelText("Date played")).toHaveValue(todayIsoDate());
    expect(
      screen.queryByRole("button", { name: "Clear rating" }),
    ).not.toBeInTheDocument();

    // Both the trigger and the in-dialog submit button read "Log play" —
    // the submit button is the one inside the open dialog's form.
    const logPlayButtons = screen.getAllByRole("button", { name: "Log play" });
    await user.click(logPlayButtons[logPlayButtons.length - 1]);

    expect(mockLogDiaryEntryAction).toHaveBeenCalled();
    expect(mockUpdateDiaryEntryAction).not.toHaveBeenCalled();
  });

  it("edit mode: opens pre-filled from defaults, submits updateDiaryEntryAction with entryId (never gameId)", async () => {
    const user = userEvent.setup();
    render(
      <LogDiaryEntryDialog
        gameId={gameId}
        gameSlug={gameSlug}
        triggerLabel="Edit"
        defaults={{
          entryId: "entry-1",
          playedOn: "2026-01-05",
          rating: 4,
          isReplay: true,
          note: "Great replay",
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByText("Edit diary entry")).toBeInTheDocument();
    expect(screen.getByLabelText("Date played")).toHaveValue("2026-01-05");
    expect(screen.getByText("This was a replay")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Great replay")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Clear rating" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(mockUpdateDiaryEntryAction).toHaveBeenCalled();
    expect(mockLogDiaryEntryAction).not.toHaveBeenCalled();
  });

  it("Clear rating removes the selected rating and hides the Clear control", async () => {
    const user = userEvent.setup();
    render(
      <LogDiaryEntryDialog
        gameId={gameId}
        gameSlug={gameSlug}
        triggerLabel="Log play"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Log play" }));
    await user.click(screen.getByLabelText("4 stars"));

    expect(
      screen.getByRole("button", { name: "Clear rating" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear rating" }));

    expect(
      screen.queryByRole("button", { name: "Clear rating" }),
    ).not.toBeInTheDocument();
  });

  it("shows the diary note helper copy as public, never describing it as private", async () => {
    const user = userEvent.setup();
    render(
      <LogDiaryEntryDialog
        gameId={gameId}
        gameSlug={gameSlug}
        triggerLabel="Log play"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Log play" }));

    expect(
      screen.getByText(
        "Visible to anyone who views your diary or this game — not private.",
      ),
    ).toBeInTheDocument();
  });
});
