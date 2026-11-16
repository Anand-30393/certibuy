import ModeChooser from "@/components/layout/ModeChooser";
import { guardArea } from "@/server/context";

export default async function WelcomePage() {
  await guardArea("seller", "/welcome");
  return <ModeChooser />;
}
