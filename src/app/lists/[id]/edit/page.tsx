import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getListDetail } from "@/server/services/lists";
import { ListForm } from "@/components/lists/list-form";
import { ListItemsManager } from "@/components/lists/list-items-manager";
import { DeleteListButton } from "@/components/lists/delete-list-button";
import { Heading } from "@/components/common/typography";
import { Separator } from "@/components/ui/separator";

export const metadata: Metadata = { title: "Edit list" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditListPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defensive — the proxy route policy already guards this page.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/lists/${id}/edit`)}`);

  const list = await getListDetail(id, user.id);
  // Not found and not-owned are both 404 here, deliberately indistinguishable
  // — never confirm to a non-owner that a list with this id exists at all.
  if (!list || !list.isOwner) notFound();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Heading level="h3" as="h1" className="mb-6">
        Edit list
      </Heading>

      <ListForm
        defaults={{
          listId: list.id,
          title: list.title,
          description: list.description,
          visibility: list.visibility,
          isRanked: list.isRanked,
        }}
      />

      <Separator className="my-8" />

      <Heading level="h4" as="h2" className="mb-4">
        Games
      </Heading>
      <ListItemsManager
        listId={list.id}
        isRanked={list.isRanked}
        initialItems={list.items.map((item) => ({
          id: item.id,
          gameSlug: item.gameSlug,
          gameName: item.gameName,
          coverImageId: item.coverImageId,
          note: item.note,
        }))}
      />

      <Separator className="my-8" />

      <DeleteListButton
        listId={list.id}
        ownerUsername={profile?.username ?? ""}
      />
    </main>
  );
}
