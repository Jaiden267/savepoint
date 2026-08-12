import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";

const { mockSignOutAction } = vi.hoisted(() => ({
  mockSignOutAction: vi.fn(),
}));

vi.mock("@/server/actions/auth", () => ({
  signOutAction: mockSignOutAction,
}));

import { MobileNavDrawer } from "./mobile-nav-drawer";

describe("MobileNavDrawer", () => {
  it("shows signed-in links (Community/Profile/Settings/Sign out) when a username is given", async () => {
    const user = userEvent.setup();
    render(<MobileNavDrawer username="playerone" />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expect(screen.getByRole("link", { name: "Community" })).toHaveAttribute(
      "href",
      "/discover/community",
    );
    expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
      "href",
      "/users/playerone",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/settings/profile",
    );
    expect(
      screen.getByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Sign in" }),
    ).not.toBeInTheDocument();
  });

  it("shows signed-out links (Discover/Community/Sign in/Sign up) when username is null", async () => {
    const user = userEvent.setup();
    render(<MobileNavDrawer username={null} />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Sign up" })).toHaveAttribute(
      "href",
      "/signup",
    );
    expect(
      screen.queryByRole("button", { name: "Sign out" }),
    ).not.toBeInTheDocument();
  });

  it("closes the drawer when a nav link is clicked (render-prop composition actually closes, not just navigates)", async () => {
    const user = userEvent.setup();
    render(<MobileNavDrawer username="playerone" />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Profile" }));

    expect(
      screen.queryByRole("link", { name: "Profile" }),
    ).not.toBeInTheDocument();
  });

  it("closes via the explicit close control", async () => {
    const user = userEvent.setup();
    render(<MobileNavDrawer username="playerone" />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    await user.click(screen.getByRole("button", { name: "Close menu" }));

    expect(
      screen.queryByRole("link", { name: "Profile" }),
    ).not.toBeInTheDocument();
  });

  it("has no axe violations while open", async () => {
    const user = userEvent.setup();
    render(<MobileNavDrawer username="playerone" />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expectNoAxeViolations(await axe(document.body));
  });
});
