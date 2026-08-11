import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 6 }, (_, index) => (
        <Skeleton key={index} className="h-24 w-full rounded-lg" />
      ))}
    </div>
  );
}
