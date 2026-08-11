import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  );
}
