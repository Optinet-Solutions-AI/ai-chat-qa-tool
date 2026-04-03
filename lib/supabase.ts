import { createClient } from '@supabase/supabase-js';

// Server-only — never import this file from client components.
// Use lib/db-client.ts for all client-side DB access.
const url = process.env.SUPABASE_URL!;
// Use service role key so RLS doesn't block server-side reads/writes.
const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY!;

export const supabase = createClient(url, key);
