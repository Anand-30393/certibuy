// X-06: profile.
import type { ProfileView } from "@certibuy/contracts";
import type { z } from "zod";
import ProfileForm from "@/components/profile/ProfileForm";
import { loadView } from "@/server/views";

export default async function ProfilePage() {
  const profile = await loadView<z.infer<typeof ProfileView>>("getProfile");
  return (
    <section className="stack narrow">
      <h1>Profile</h1>
      <ProfileForm profile={profile} />
    </section>
  );
}
