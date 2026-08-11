import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ListPlus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getListDetail } from "@/server/services/lists";
import { ListItemRow } from "@/components/lists/list-item-row";
import { EmptyState } from "@/components/common/empty-state";
import { LinkButton } from "@/components/common/link-button";
import { Badge } from "@/components/ui/badge";
import { Heading, Text } from "@/components/common/typography";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const list = await getListDetail(id, null);
  return { title: list?.title ?? "List" };
}

/**
 * Public (visibility-permitting) list detail. `getListDetail` returns null
 * for a private list the viewer doesn't own (RLS already filtered it) or a
 * missing list — both `notFound()`, indistinguishable to the visitor, which
 * is the correct behavior (never reveal that a private list with this id
 * exists). Renders fully for a signed-out visitor.
 */
export default async function ListDetailPage({ params }: Props) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser();

  const list = await getListDetail(id, viewer?.id ?? null);
  if (!list) notFound();

  const { data: authorProfile } = await supabase
    .from("profiles")
    .select("username, display_name")
    .eq("id", list.userId)
    .maybeSingle();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Heading level="h3" as="h1">
              {list.title}
            </Heading>
            {list.visibility !== "public" ? (
              <Badge variant="outline">
                {list.visibility === "private" ? "Private" : "Unlisted"}
              </Badge>
            ) : null}
          </div>
          {authorProfile ? (
            <Text tone="muted" size="sm" className="mt-1">
              by{" "}
              <Link
                href={`/users/${authorProfile.username}`}
                className="hover:underline"
              >
                {authorProfile.display_name || authorProfile.username}
              </Link>
              {list.isRanked ? " · Ranked" : ""}
            </Text>
          ) : null}
          {list.description ? (
            <Text className="mt-3 text-pretty">{list.description}</Text>
          ) : null}
        </div>
        {list.isOwner ? (
          <LinkButton variant="secondary" href={`/lists/${list.id}/edit`}>
            Edit list
          </LinkButton>
        ) : null}
      </div>

      <div className="mt-8">
        {list.items.length === 0 ? (
          <EmptyState
            icon={ListPlus}
            title="No games yet"
            description={
              list.isOwner ? "Add games from the edit page." : undefined
            }
            action={
              list.isOwner ? (
                <LinkButton href={`/lists/${list.id}/edit`}>
                  Add games
                </LinkButton>
              ) : undefined
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {list.items.map((item) => (
              <ListItemRow
                key={item.id}
                listId={list.id}
                item={item}
                canEdit={false}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
