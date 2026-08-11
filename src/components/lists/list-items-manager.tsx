"use client";

import { useState, useTransition } from "react";
import { ListPlus } from "lucide-react";
import { AddGameToListDialog } from "@/components/lists/add-game-to-list-dialog";
import {
  ListItemRow,
  type ListItemRowData,
} from "@/components/lists/list-item-row";
import {
  ReorderControls,
  type ReorderDirection,
} from "@/components/lists/reorder-controls";
import {
  reorderListItemsAction,
  type AddListItemResult,
} from "@/server/actions/lists";
import { EmptyState } from "@/components/common/empty-state";

interface ListItemsManagerProps {
  listId: string;
  isRanked: boolean;
  initialItems: ListItemRowData[];
}

function moveItem(
  items: ListItemRowData[],
  index: number,
  direction: ReorderDirection,
): ListItemRowData[] {
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (!item) return items;

  let target: number;
  if (direction === "top") target = 0;
  else if (direction === "bottom") target = next.length;
  else if (direction === "up") target = Math.max(0, index - 1);
  else target = Math.min(next.length, index + 1);

  next.splice(target, 0, item);
  return next;
}

/**
 * Owns the client-side item list for a list's edit page: wires
 * AddGameToListDialog (adds), ListItemRow (per-item note/remove), and
 * ReorderControls (ranked lists only) together, calling
 * reorderListItemsAction — an atomic single RPC call via the
 * `reorder_list_items` database function (migration 19) — on every move,
 * with an optimistic local reorder rolled back on error.
 */
export function ListItemsManager({
  listId,
  isRanked,
  initialItems,
}: ListItemsManagerProps) {
  const [items, setItems] = useState(initialItems);
  const [isPending, startTransition] = useTransition();

  function handleAdded(item: NonNullable<AddListItemResult["item"]>) {
    setItems((prev) => [
      ...prev,
      {
        id: item.id,
        gameSlug: item.gameSlug,
        gameName: item.gameName,
        coverImageId: item.coverImageId,
        note: item.note,
      },
    ]);
  }

  function handleMove(index: number, direction: ReorderDirection) {
    const previous = items;
    const next = moveItem(items, index, direction);
    setItems(next);
    startTransition(async () => {
      const result = await reorderListItemsAction(
        listId,
        next.map((i) => i.id),
      );
      if (result.status === "error") {
        setItems(previous);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-foreground text-sm font-medium">
          {items.length} game{items.length === 1 ? "" : "s"}
        </p>
        <AddGameToListDialog listId={listId} onAdded={handleAdded} />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={ListPlus}
          title="No games yet"
          description="Search above to add your first game to this list."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item, index) => (
            <ListItemRow
              key={item.id}
              listId={listId}
              item={item}
              canEdit
              reorderControls={
                isRanked ? (
                  <ReorderControls
                    index={index}
                    total={items.length}
                    disabled={isPending}
                    onMove={(direction) => handleMove(index, direction)}
                  />
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
