import { ListPageSkeleton } from "@/components/status/skeletons";

export default function Loading() {
  return <ListPageSkeleton label="approvals" chips={0} rows={5} />;
}
