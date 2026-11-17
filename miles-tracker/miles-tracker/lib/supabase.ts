import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function browserDb() {
  return createClient(supabaseUrl, supabaseKey);
}

export function serverDb() {
  return createClient(supabaseUrl, supabaseKey);
}

export function supabaseBrowser() {
  return browserDb();
}
