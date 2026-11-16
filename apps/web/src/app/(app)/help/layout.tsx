import type { ReactNode } from "react";
import { guardArea } from "@/server/context";

export default async function AreaLayout({ children }: { children: ReactNode }) {
  await guardArea("help", "/help");
  return children;
}
