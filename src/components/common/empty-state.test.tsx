import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";
import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";

describe("EmptyState", () => {
  it("renders the title, description and action", () => {
    render(
      <EmptyState
        title="No games yet"
        description="Rate a game to see it here."
        action={<button type="button">Browse games</button>}
      />,
    );

    expect(screen.getByText("No games yet")).toBeInTheDocument();
    expect(screen.getByText("Rate a game to see it here.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Browse games" }),
    ).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("renders a default message and calls onRetry when clicked", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();

    render(<ErrorState onRetry={onRetry} />);

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("has no axe violations (spot-check)", async () => {
    const { container } = render(<ErrorState onRetry={() => {}} />);

    expectNoAxeViolations(await axe(container));
  });
});
