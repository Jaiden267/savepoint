import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renders the title as an h1", () => {
    render(<PageHeader title="Library" />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Library" }),
    ).toBeInTheDocument();
  });

  it("renders an optional description and action", () => {
    render(
      <PageHeader
        title="Discover"
        description="Browse the catalogue"
        action={<button type="button">New list</button>}
      />,
    );

    expect(screen.getByText("Browse the catalogue")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New list" }),
    ).toBeInTheDocument();
  });

  it("omits the description and action when not provided", () => {
    render(<PageHeader title="Diary" />);

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <PageHeader
        title="Discover"
        description="Browse the catalogue"
        action={<button type="button">New list</button>}
      />,
    );

    expectNoAxeViolations(await axe(container));
  });
});
