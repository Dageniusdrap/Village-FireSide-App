import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";

import { connect, createUser } from "./local-stack";

describe("integration harness", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = await connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("reaches the local database", async () => {
    const { rows } = await client.query<{ ok: number }>("select 1 as ok");
    expect(rows[0]!.ok).toBe(1);
  });

  it("creates an admin user", async () => {
    const id = await createUser(client, "admin");
    const { rows } = await client.query<{ role: string }>(
      "select role from public.profiles where id = $1",
      [id],
    );
    expect(rows[0]!.role).toBe("admin");
  });
});
