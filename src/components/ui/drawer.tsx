"use client";

import * as React from "react";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";

import { cn } from "@/lib/utils";

/**
 * Edge-anchored panel (used for the mobile nav menu), not the bottom-sheet/
 * snap-point use case this primitive also supports. `swipeDirection="right"`
 * is the default here (dismissed by swiping right, matching the panel
 * sliding in from the right edge) and can be overridden by a caller that
 * needs a different edge.
 */
function Drawer(props: DrawerPrimitive.Root.Props) {
  return (
    <DrawerPrimitive.Root
      swipeDirection="right"
      data-slot="drawer"
      {...props}
    />
  );
}

function DrawerTrigger(props: DrawerPrimitive.Trigger.Props) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose(props: DrawerPrimitive.Close.Props) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerBackdrop({
  className,
  ...props
}: DrawerPrimitive.Backdrop.Props) {
  return (
    <DrawerPrimitive.Backdrop
      data-slot="drawer-backdrop"
      className={cn(
        "fixed inset-0 z-50 bg-black/60 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      {...props}
    />
  );
}

function DrawerPopup({
  className,
  children,
  ...props
}: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.Portal data-slot="drawer-portal">
      <DrawerBackdrop />
      {/*
       * Base UI requires Popup to render inside Viewport — omitting it
       * silently disables touch scroll-locking and swipe handling (a real,
       * console-warned defect caught by drawer.test.tsx, not assumed from
       * the props existing). Viewport owns the fixed edge-anchored
       * positioning; Popup owns the visual surface + enter/exit transform.
       */}
      <DrawerPrimitive.Viewport
        data-slot="drawer-viewport"
        className="fixed inset-y-0 right-0 z-50 w-full max-w-xs"
      >
        <DrawerPrimitive.Popup
          data-slot="drawer-popup"
          className={cn(
            "bg-popover text-popover-foreground ring-foreground/10 flex h-full w-full flex-col gap-4 overflow-y-auto p-4 shadow-lg ring-1 transition-transform data-ending-style:translate-x-full data-starting-style:translate-x-full",
            className,
          )}
          {...props}
        >
          {children}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-heading text-base font-medium", className)}
      {...props}
    />
  );
}

function DrawerDescription({
  className,
  ...props
}: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerTrigger,
  DrawerClose,
  DrawerBackdrop,
  DrawerPopup,
  DrawerTitle,
  DrawerDescription,
};
