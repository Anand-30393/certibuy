import type { ReactNode } from "react";
import { guardArea } from "@/server/context";

export default async function AreaLayout({ children }: { children: ReactNode }) {
  await guardArea("account", "/profile");
  return children;
}
