import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReorderControls } from "./reorder-controls";

describe("ReorderControls", () => {
  it("disables 'Move to top'/'Move up' at the first item", () => {
    render(<ReorderControls index={0} total={5} onMove={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Move to top" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move down" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move to bottom" }),
    ).toBeEnabled();
  });

  it("disables 'Move down'/'Move to bottom' at the last item", () => {
    render(<ReorderControls index={4} total={5} onMove={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Move down" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move to bottom" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move to top" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move up" })).toBeEnabled();
  });

  it("disables every control when disabled is passed, regardless of position", () => {
    render(<ReorderControls index={2} total={5} disabled onMove={vi.fn()} />);

    for (const name of [
      "Move to top",
      "Move up",
      "Move down",
      "Move to bottom",
    ]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("calls onMove with the correct direction for each control", async () => {
    const onMove = vi.fn();
    const user = userEvent.setup();
    render(<ReorderControls index={2} total={5} onMove={onMove} />);

    await user.click(screen.getByRole("button", { name: "Move to top" }));
    await user.click(screen.getByRole("button", { name: "Move up" }));
    await user.click(screen.getByRole("button", { name: "Move down" }));
    await user.click(screen.getByRole("button", { name: "Move to bottom" }));

    expect(onMove.mock.calls.map((call) => call[0])).toEqual([
      "top",
      "up",
      "down",
      "bottom",
    ]);
  });

  it("exposes a group label announcing position for screen readers", () => {
    render(<ReorderControls index={2} total={5} onMove={vi.fn()} />);

    expect(
      screen.getByRole("group", { name: "Reorder item 3 of 5" }),
    ).toBeInTheDocument();
  });
});
