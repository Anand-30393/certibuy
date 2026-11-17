// @certibuy/integrations — ports for external effects. Adapters live beside them; the Supabase
// adapters are under ./supabase and are the only code that imports @supabase/*.
export * from "./ports";
export * from "./payouts/simulated";
export * from "./mail/simulated";
