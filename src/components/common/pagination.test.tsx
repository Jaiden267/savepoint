import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";
import { Pagination } from "./pagination";

describe("Pagination", () => {
  it("hides Previous on the first page and links Next to page + 1", () => {
    const makeHref = vi.fn((page: number) => `/discover?page=${page}`);
    render(<Pagination page={1} hasMore makeHref={makeHref} />);

    expect(
      screen.queryByRole("link", { name: "Previous" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute(
      "href",
      "/discover?page=2",
    );
  });

  it("hides Next when there are no more pages", () => {
    const makeHref = (page: number) => `/discover?page=${page}`;
    render(<Pagination page={3} hasMore={false} makeHref={makeHref} />);

    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute(
      "href",
      "/discover?page=2",
    );
    expect(
      screen.queryByRole("link", { name: "Next" }),
    ).not.toBeInTheDocument();
  });

  it("labels the nav landmark for assistive tech", () => {
    render(
      <Pagination
        page={2}
        hasMore
        makeHref={(page) => `/library?page=${page}`}
      />,
    );

    expect(
      screen.getByRole("navigation", { name: "Pagination" }),
    ).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <Pagination
        page={2}
        hasMore
        makeHref={(page) => `/library?page=${page}`}
      />,
    );

    expectNoAxeViolations(await axe(container));
  });
});
