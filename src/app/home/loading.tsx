import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <Skeleton className="h-8 w-32" />
      <div className="mt-6 flex flex-col gap-3">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-lg" />
        ))}
      </div>
    </main>
  );
}
