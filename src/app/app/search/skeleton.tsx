import { ListPageSkeleton } from "@/components/status/skeletons";

export default function Loading() {
  return <ListPageSkeleton label="search" chips={0} rows={6} />;
}
