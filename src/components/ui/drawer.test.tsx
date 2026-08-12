import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import { expectNoAxeViolations } from "@/test/axe";
import {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerPopup,
  DrawerTitle,
  DrawerDescription,
} from "./drawer";

function TestDrawer() {
  return (
    <Drawer>
      <DrawerTrigger>Open menu</DrawerTrigger>
      <DrawerPopup>
        <DrawerTitle>Menu</DrawerTitle>
        <DrawerDescription>Secondary navigation</DrawerDescription>
        <a href="/discover/community">Community</a>
        <DrawerClose>Close menu</DrawerClose>
      </DrawerPopup>
    </Drawer>
  );
}

describe("Drawer", () => {
  it("opens on trigger click and renders its content", async () => {
    const user = userEvent.setup();
    render(<TestDrawer />);

    expect(screen.queryByText("Secondary navigation")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expect(screen.getByText("Secondary navigation")).toBeInTheDocument();
  });

  it("moves focus into the popup on open", async () => {
    const user = userEvent.setup();
    render(<TestDrawer />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    // Base UI defers the initial-focus move a tick past the click handler —
    // waitFor rather than a synchronous assertion, matching the same
    // pattern this codebase already uses for other async UI state
    // (status-selector.test.tsx).
    const popup = screen.getByText("Secondary navigation").closest("div");
    await waitFor(() => {
      expect(popup).toContainElement(document.activeElement as HTMLElement);
    });
  });

  it("traps Tab focus inside the popup while open", async () => {
    const user = userEvent.setup();
    render(<TestDrawer />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const link = screen.getByRole("link", { name: "Community" });
    const closeButton = screen.getByRole("button", { name: "Close menu" });

    // Cycle forward enough times to guarantee we've wrapped at least once —
    // focus must never land back on the (visually hidden, inert) trigger.
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
    }

    expect(
      [link, closeButton].includes(document.activeElement as HTMLElement),
    ).toBe(true);
  });

  it("closes on Escape and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<TestDrawer />);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    expect(screen.getByText("Secondary navigation")).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByText("Secondary navigation")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes via the close control and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<TestDrawer />);

    const trigger = screen.getByRole("button", { name: "Open menu" });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close menu" }));

    expect(screen.queryByText("Secondary navigation")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes on backdrop click", async () => {
    const user = userEvent.setup();
    render(<TestDrawer />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByText("Secondary navigation")).toBeInTheDocument();

    const backdrop = document.querySelector('[data-slot="drawer-backdrop"]');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop as Element);

    expect(screen.queryByText("Secondary navigation")).not.toBeInTheDocument();
  });

  it("locks page scroll while open", async () => {
    const user = userEvent.setup();
    render(<TestDrawer />);

    expect(document.body.style.overflowY).not.toBe("hidden");

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expect(document.body.style.overflowY).toBe("hidden");
    expect(document.body.style.overflowX).toBe("hidden");
  });

  it("has no axe violations while open", async () => {
    const user = userEvent.setup();
    render(<TestDrawer />);

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    expectNoAxeViolations(await axe(document.body));
  });
});
