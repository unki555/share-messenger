import { createClient } from "@supabase/supabase-js";

const url =
  import.meta.env.VITE_SUPABASE_URL ||
  "https://dlneweqfmbkcjrjncbaa.supabase.co";

const key =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "sb_publishable_XGaEWpB4wpma0l-no9R6JA_wQrgQkUR";

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** Синтетический email для Auth по username */
export function usernameToEmail(username: string) {
  return `${username.toLowerCase()}@share.local`;
}
