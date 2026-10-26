import { Skeleton } from "@/components/ui/display";
import { PageLoader } from "@/components/brand/DotLoader";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <PageLoader label="Loading event" />
      <Skeleton className="h-4 w-24" />
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-md" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-8 w-2/5" />
          <Skeleton className="h-4 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-11 w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[104px] rounded-lg" />)}
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
