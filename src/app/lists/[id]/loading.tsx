import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <Skeleton className="h-8 w-64" />
      <div className="mt-8 flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    </main>
  );
}
