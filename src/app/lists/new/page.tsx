import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ListForm } from "@/components/lists/list-form";
import { PageHeader } from "@/components/common/page-header";

export const metadata: Metadata = { title: "New list" };

export default async function NewListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Defensive — the proxy route policy already guards this page.
  if (!user) redirect("/login?next=/lists/new");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <PageHeader title="Create a list" />
      <ListForm />
    </main>
  );
}
