// Role router (X-03): technician → /hub, ops → /ops, customer → saved mode or the chooser.
import { homeFor } from "@certibuy/application";
import { redirect } from "next/navigation";
import { getActor } from "@/server/actor";

export default async function Home() {
  const actor = await getActor();
  redirect(actor ? homeFor(actor) : "/login");
}
