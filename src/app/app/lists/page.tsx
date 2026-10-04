import { redirect } from "next/navigation";

/** Lists live on Properties → Lists. */
export default function ListsPage() {
  redirect("/app/properties?tab=lists");
}
