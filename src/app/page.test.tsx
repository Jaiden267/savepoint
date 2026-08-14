import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Home from "./page";

describe("Home page", () => {
  it("does not render the 'Foundation scaffold' placeholder label", () => {
    render(<Home />);

    expect(screen.queryByText(/Foundation scaffold/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/these features arrive in later milestones/i),
    ).not.toBeInTheDocument();
  });

  it("still renders the hero heading and feature cards", () => {
    render(<Home />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Track, rate and discover the games you play.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Track everything you play")).toBeInTheDocument();
  });
});
