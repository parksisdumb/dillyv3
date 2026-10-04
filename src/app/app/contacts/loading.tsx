import { ListPageSkeleton } from "@/components/status/skeletons";

export default function Loading() {
  return <ListPageSkeleton label="contacts" chips={5} />;
}
