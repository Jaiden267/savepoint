import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-32 w-full rounded-lg" />
      ))}
    </div>
  );
}
