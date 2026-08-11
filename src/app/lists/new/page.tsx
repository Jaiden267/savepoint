import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ListForm } from "@/components/lists/list-form";
import { Heading } from "@/components/common/typography";

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
      <Heading level="h3" as="h1" className="mb-6">
        Create a list
      </Heading>
      <ListForm />
    </main>
  );
}
