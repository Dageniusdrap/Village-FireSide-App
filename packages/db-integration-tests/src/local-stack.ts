import { execFileSync } from "node:child_process";

import pg from "pg";

export const LOCAL_DB_URL =
  process.env.LOCAL_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const LOCAL_API_URL = process.env.LOCAL_API_URL ?? "http://127.0.0.1:54321";

let cachedKeys: { anonKey: string; serviceRoleKey: string } | null = null;

export function localKeys(): { anonKey: string; serviceRoleKey: string } {
  if (cachedKeys) {
    return cachedKeys;
  }
  const fromEnv = {
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (fromEnv.anonKey && fromEnv.serviceRoleKey) {
    cachedKeys = { anonKey: fromEnv.anonKey, serviceRoleKey: fromEnv.serviceRoleKey };
    return cachedKeys;
  }
  const status = JSON.parse(
    execFileSync("supabase", ["status", "-o", "json"], { encoding: "utf8" }),
  ) as { ANON_KEY: string; SERVICE_ROLE_KEY: string };
  cachedKeys = { anonKey: status.ANON_KEY, serviceRoleKey: status.SERVICE_ROLE_KEY };
  return cachedKeys;
}

export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: LOCAL_DB_URL });
  await client.connect();
  await client.query("set statement_timeout = '30s'");
  return client;
}

export async function beginAs(client: pg.Client, userId: string): Promise<void> {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
  await client.query("set local role authenticated");
}

export async function createUser(
  client: pg.Client,
  role: "admin" | "teacher" | "listener",
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
             gen_random_uuid()::text || '@test.local', '{}'::jsonb, now(), now())
     returning id`,
  );
  const id = rows[0]!.id;
  if (role !== "listener") {
    await client.query("begin");
    await client.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
    await client.query("update public.profiles set role = $1 where id = $2", [role, id]);
    await client.query("commit");
  }
  return id;
}
