import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  );
}
