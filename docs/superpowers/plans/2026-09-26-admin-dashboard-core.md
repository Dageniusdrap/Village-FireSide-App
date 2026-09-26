# Admin Dashboard Core (Prompt 14) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the admin dashboard's first real content-management surface in `apps/admin` — layout (sidebar + top bar), full CRUD for Series/Episodes/Destinations, an episode publish-validation guard, and an `admin_actions` audit log.

**Architecture:** A `(dashboard)` Next.js route group holds every authenticated page behind a shared sidebar/top-bar layout. Every write goes through a Server Action following the existing `teacher-requests/actions.ts` pattern (cookie-session admin check, then a service-role client for the actual write), logging to `admin_actions` afterward. Client forms use react-hook-form + zod, matching the existing sign-in page. A small set of shared UI primitives and a headless `DataTable` shell avoid duplicating markup across three CRUD sections.

**Tech Stack:** Next.js 16 (App Router, Server Actions), React 19, Tailwind v4, react-hook-form + zod, Supabase (`@supabase/ssr` for cookie sessions, `@supabase/supabase-js` for the service-role client), Leaflet + react-leaflet (new dependency, for the destination map picker), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-26-admin-dashboard-core-design.md`

## Global Constraints

- **Every write goes through a Server Action using the service-role client** (`apps/admin/src/lib/supabase/service-role.ts`) — never exposed client-side.
- **Every Server Action calls `requireAdmin()` first** (`apps/admin/src/lib/require-admin.ts`, Task 3) — a Server Action is its own callable endpoint and gets no protection from `proxy.ts`'s route matcher, which only guards page navigation.
- **Every create/update/publish/unpublish/delete action calls `logAdminAction()`** (Task 3) right after its real write succeeds. `logAdminAction()` never throws and never fails the calling action — it catches its own errors and `console.error`s them. Read-only actions (`validateEpisodeForPublish`) do not log.
- **Client-side form validation only** — zod schemas live in `apps/admin/src/lib/validation.ts` and are used by `zodResolver` in each `*Form` component, matching the sign-in page's existing pattern. Server Actions take plain typed parameters and rely on TypeScript + the database's own constraints (unique slugs, unique `(series_id, episode_number, language)`, etc.) — matching `teacher-requests/actions.ts`'s existing precedent of no server-side zod re-validation.
- **No automated tests for React pages, components, or Server Actions that primarily orchestrate I/O** — matches this app's existing precedent (`proxy.test.ts`/`validation.test.ts` test only pure logic: `decideRedirect()` and zod schemas, never the surrounding I/O). **Pure logic does get real tests**: `slugify()` (Task 2) and `checkPublishRequirements()` (Task 12).
- **New dependencies are limited to `leaflet` and `react-leaflet`** (Task 19) — nothing else. `slugify()` lives in `apps/admin/src/lib/slugify.ts`, **not** `packages/shared`: that package currently has zero test infrastructure (`packages/shared/src/index.ts` is a single placeholder export, no test script in its `package.json`) and no other app needs slug generation, so putting a pure util there now would mean standing up a test runner for a package with no other tests, for a function only `apps/admin` consumes. This is a deliberate, small deviation from the design spec's stated location — flagged here rather than silently changed.
- **Route groups don't add a URL segment** — moving `teacher-requests` into `(dashboard)/teacher-requests/` (Task 6) does not change its URL; no links elsewhere need updating.
- **Every task must leave `pnpm typecheck` clean.**
- **Migration timestamps continue this repo's `supabase/migrations/YYYYMMDDHHmmss` sequence** — the last one on `main` is `20260803100200` (the `daily-engagement` branch's own `2026092...` migrations are on an unmerged PR, not yet on `main`); this plan's one migration uses `20260926100000`, safely after both.
- **Commit after every task**, following this repo's convention: `git commit -m "Prompt 14: <description>"`.

---

### Task 1: Migration — `admin_actions`

**Files:**

- Create: `supabase/migrations/20260926100000_admin_actions.sql`

**Interfaces:**

- Produces: `admin_actions` table (admin-select-only RLS). Consumed by Task 3's `logAdminAction()`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260926100000_admin_actions.sql

create table admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references profiles (id),
  action text not null,
  entity_type text not null,
  entity_id uuid not null,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table admin_actions enable row level security;

create policy admin_actions_admin_select
  on admin_actions for select
  using (is_admin());
```

- [ ] **Step 2: Apply the migration to the live linked project**

```bash
set -a && source .env.supabase-cli.local 2>/dev/null && set +a
supabase db push
```

- [ ] **Step 3: Confirm it applied**

```bash
supabase migration list
```

Expected: `20260926100000` appears with matching `local`/`remote` values. Do not trust `db push`'s exit code alone — confirm via this command's actual output.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260926100000_admin_actions.sql
git commit -m "Prompt 14: add admin_actions audit log table"
```

---

### Task 2: `slugify()` — shared slug generation

**Files:**

- Create: `apps/admin/src/lib/slugify.ts`
- Test: `apps/admin/src/lib/slugify.test.ts`

**Interfaces:**

- Produces: `slugify(input: string): string`. Consumed by Task 9 (`SeriesForm`) and Task 20 (`DestinationForm`).

- [ ] **Step 1: Write the failing test**

```ts
// apps/admin/src/lib/slugify.test.ts
import { describe, expect, it } from "vitest";

import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(slugify("Lake Bunyonyi Stories")).toBe("lake-bunyonyi-stories");
  });

  it("strips punctuation", () => {
    expect(slugify("Grandma's Tale: Part One!")).toBe("grandmas-tale-part-one");
  });

  it("collapses multiple spaces/hyphens into one", () => {
    expect(slugify("Two   Rivers -- One Story")).toBe("two-rivers-one-story");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  -Elder Voices-  ")).toBe("elder-voices");
  });

  it("returns an empty string for an empty input", () => {
    expect(slugify("")).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/admin && npx vitest run slugify.test.ts
```

Expected: FAIL — `slugify.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin/src/lib/slugify.ts

// Kebab-case slug generation for series/destination slugs — deterministic
// and simple. Uniqueness is enforced by each table's own `unique`
// constraint, surfaced as a form error; this function doesn't check
// uniqueness itself.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/[\s-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/admin && npx vitest run slugify.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/lib/slugify.ts apps/admin/src/lib/slugify.test.ts
git commit -m "Prompt 14: add slugify utility"
```

---

### Task 3: Shared admin-action infrastructure — `requireAdmin()` + `logAdminAction()`

**Files:**

- Create: `apps/admin/src/lib/require-admin.ts`
- Create: `apps/admin/src/lib/log-admin-action.ts`
- Modify: `apps/admin/src/app/teacher-requests/actions.ts`

**Interfaces:**

- Produces: `requireAdmin(): Promise<{ ok: true; adminId: string } | { ok: false; message: string }>`; `logAdminAction(adminId: string, action: string, entityType: string, entityId: string, details?: Record<string, unknown>): Promise<void>`. Consumed by every Server Action in Tasks 8, 11, 13, 18.

- [ ] **Step 1: Extract `requireAdmin()` into its own file**

Read `apps/admin/src/app/teacher-requests/actions.ts` first — it currently defines `requireAdmin()` inline, returning `ActionResult` (`{ ok: true } | { ok: false; message: string }`). The extracted version needs to also return the admin's id, since `logAdminAction()` needs it and nothing currently exposes it. Change the return type accordingly (every future caller needs the id; the two existing call sites in `teacher-requests/actions.ts` don't use it today but will keep compiling since they only check `.ok`).

```ts
// apps/admin/src/lib/require-admin.ts
import { createClient } from "@/lib/supabase/server";

export type RequireAdminResult = { ok: true; adminId: string } | { ok: false; message: string };

// A Server Action is its own callable endpoint and gets no protection
// from proxy.ts's route matcher, which only guards page navigation —
// every Server Action that writes anything must check this itself,
// using the caller's own cookie-scoped session (never the service-role
// client, which has no notion of "caller").
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, message: "Not signed in." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return { ok: false, message: "Not authorized." };
  }

  return { ok: true, adminId: user.id };
}
```

- [ ] **Step 2: Update `teacher-requests/actions.ts` to import the shared version**

Remove the inline `requireAdmin()` function and its `async function requireAdmin(): Promise<ActionResult>` signature from `apps/admin/src/app/teacher-requests/actions.ts`, replacing it with an import:

```ts
import { requireAdmin } from "@/lib/require-admin";
```

Both existing call sites (`approveTeacherRequest`, `rejectTeacherRequest`) currently do:

```ts
const admin = await requireAdmin();
if (!admin.ok) {
  return admin;
}
```

This still compiles unchanged: `{ ok: false, message }` has the same shape either way, and neither call site currently reads `admin.adminId` — but check both call sites yourself after removing the inline function to confirm nothing else in the file referenced the old local function by a name or shape assumption this change breaks.

- [ ] **Step 3: Write `logAdminAction()`**

```ts
// apps/admin/src/lib/log-admin-action.ts
import { createServiceRoleClient } from "@/lib/supabase/service-role";

// Best-effort: never throws, never fails the calling action. admin_actions
// is a record-keeping/accountability trail, not data the app depends on
// to function — failing a real content-management operation (e.g. a
// publish) because an unrelated audit-log insert had a transient issue
// would be worse UX for no real integrity benefit. A failed log write is
// a silent gap unless someone is watching server logs; that tradeoff is
// deliberate (see docs/superpowers/specs/2026-09-26-admin-dashboard-core-design.md).
export async function logAdminAction(
  adminId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("admin_actions").insert({
      admin_id: adminId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details: details ?? null,
    });
    if (error) {
      console.error("logAdminAction failed:", error);
    }
  } catch (err) {
    console.error("logAdminAction threw:", err);
  }
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Run the existing admin test suite** (confirms the `teacher-requests` refactor didn't break anything already covered)

```bash
cd apps/admin && npx vitest run
```

Expected: PASS, all existing tests (there is no test file for `teacher-requests/actions.ts` itself — it was never covered, matching this app's untested-I/O-wrapper precedent — but `proxy.test.ts` and `validation.test.ts` must still pass).

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/lib/require-admin.ts apps/admin/src/lib/log-admin-action.ts apps/admin/src/app/teacher-requests/actions.ts
git commit -m "Prompt 14: extract requireAdmin, add logAdminAction"
```

---

### Task 4: Shared UI primitives

**Files:**

- Create: `apps/admin/src/components/button.tsx`
- Create: `apps/admin/src/components/text-input.tsx`
- Create: `apps/admin/src/components/textarea.tsx`
- Create: `apps/admin/src/components/select.tsx`
- Create: `apps/admin/src/components/toggle.tsx`

**Interfaces:**

- Produces: `Button`, `TextInput`, `Textarea`, `Select`, `Toggle` components. Consumed by every form/page task from Task 9 onward.

These are small styling wrappers, not a design system — each just applies this app's existing Tailwind conventions (seen in `sign-in/page.tsx`) to a native element, forwarding all standard props through so `react-hook-form`'s `register()` spreads onto them normally.

- [ ] **Step 1: Write `Button`**

```tsx
// apps/admin/src/components/button.tsx
import type { ButtonHTMLAttributes } from "react";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
};

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-[#1F3B2C] text-white hover:bg-[#16291f]",
  secondary: "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
  danger: "bg-red-700 text-white hover:bg-red-800",
};

export function Button({ variant = "primary", className, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`rounded px-3 py-2 font-medium disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className ?? ""}`}
    />
  );
}
```

- [ ] **Step 2: Write `TextInput`**

```tsx
// apps/admin/src/components/text-input.tsx
import { forwardRef, type InputHTMLAttributes } from "react";

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function TextInput({ className, ...props }, ref) {
    return (
      <input
        {...props}
        ref={ref}
        className={`rounded border border-gray-300 px-3 py-2 ${className ?? ""}`}
      />
    );
  },
);
```

- [ ] **Step 3: Write `Textarea`**

```tsx
// apps/admin/src/components/textarea.tsx
import { forwardRef, type TextareaHTMLAttributes } from "react";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      {...props}
      ref={ref}
      className={`rounded border border-gray-300 px-3 py-2 ${className ?? ""}`}
    />
  );
});
```

- [ ] **Step 4: Write `Select`**

```tsx
// apps/admin/src/components/select.tsx
import { forwardRef, type SelectHTMLAttributes } from "react";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        {...props}
        ref={ref}
        className={`rounded border border-gray-300 bg-white px-3 py-2 ${className ?? ""}`}
      >
        {children}
      </select>
    );
  },
);
```

- [ ] **Step 5: Write `Toggle`**

```tsx
// apps/admin/src/components/toggle.tsx
import { forwardRef, type InputHTMLAttributes } from "react";

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
};

// A plain labeled checkbox rendered to look like a toggle via accent-color
// — no new dependency for a visual switch. `register()` spreads onto this
// exactly as it would onto a raw `<input type="checkbox">`.
export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(function Toggle(
  { label, className, ...props },
  ref,
) {
  return (
    <label className={`flex items-center gap-2 ${className ?? ""}`}>
      <input {...props} ref={ref} type="checkbox" className="h-5 w-5 accent-[#1F3B2C]" />
      <span>{label}</span>
    </label>
  );
});
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/components/button.tsx apps/admin/src/components/text-input.tsx apps/admin/src/components/textarea.tsx apps/admin/src/components/select.tsx apps/admin/src/components/toggle.tsx
git commit -m "Prompt 14: add shared UI primitives"
```

---

### Task 5: `DataTable` shell

**Files:**

- Create: `apps/admin/src/components/data-table.tsx`

**Interfaces:**

- Produces: `DataTable<T>({ columns, rows, searchPlaceholder, filterRow }: DataTableProps<T>)`. Consumed by Task 10 (`SeriesTable`), Task 17 (`EpisodeTable`), Task 22 (`DestinationTable`).

Headless in the sense that it owns only the search input + table markup; each consumer supplies its own column definitions, its own filter predicate (so "series" can filter on title/category/slug while "episodes" filters on title/series/status, without this component knowing about either), and its own row-action buttons as a column.

- [ ] **Step 1: Write `DataTable`**

```tsx
// apps/admin/src/components/data-table.tsx
"use client";

import { useState } from "react";

import { TextInput } from "@/components/text-input";

export type DataTableColumn<T> = {
  header: string;
  cell: (row: T) => React.ReactNode;
};

export type DataTableProps<T> = {
  columns: DataTableColumn<T>[];
  rows: T[];
  searchPlaceholder: string;
  /** Returns true if `row` matches `query` (already lowercased by this component). */
  filterRow: (row: T, query: string) => boolean;
  getRowKey: (row: T) => string;
};

export function DataTable<T>({
  columns,
  rows,
  searchPlaceholder,
  filterRow,
  getRowKey,
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const lowerQuery = query.trim().toLowerCase();
  const filteredRows = lowerQuery ? rows.filter((row) => filterRow(row, lowerQuery)) : rows;

  return (
    <div className="flex flex-col gap-3">
      <TextInput
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />
      {filteredRows.length === 0 ? (
        <p className="text-gray-500">No results.</p>
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b">
              {columns.map((column) => (
                <th key={column.header} className="py-2">
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => (
              <tr key={getRowKey(row)} className="border-b">
                {columns.map((column) => (
                  <td key={column.header} className="py-2">
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/components/data-table.tsx
git commit -m "Prompt 14: add DataTable shell"
```

---

### Task 6: Layout — sidebar, top bar, dashboard route group

**Files:**

- Create: `apps/admin/src/components/sidebar.tsx`
- Create: `apps/admin/src/components/top-bar.tsx`
- Create: `apps/admin/src/app/(dashboard)/layout.tsx`
- Create: `apps/admin/src/app/(dashboard)/page.tsx`
- Delete: `apps/admin/src/app/page.tsx` (default Next.js template — replaced by the dashboard overview above)
- Move: `apps/admin/src/app/teacher-requests/page.tsx` → `apps/admin/src/app/(dashboard)/teacher-requests/page.tsx`
- Move: `apps/admin/src/app/teacher-requests/actions.ts` → `apps/admin/src/app/(dashboard)/teacher-requests/actions.ts`
- Move: `apps/admin/src/app/teacher-requests/approve-reject-buttons.tsx` → `apps/admin/src/app/(dashboard)/teacher-requests/approve-reject-buttons.tsx`

**Interfaces:**

- Consumes: `logAdminAction`/`requireAdmin` unaffected by the move (they use `@/lib/...` absolute imports, not relative paths, so moving the folder doesn't break anything inside it).
- Produces: the `(dashboard)` layout every subsequent page (Series, Episodes, Destinations, placeholders) renders inside.

Route groups (`(dashboard)`) don't add a URL segment in Next.js's App Router — `/teacher-requests` stays `/teacher-requests` after this move. No links elsewhere reference these files by path (only by URL), so nothing else needs updating.

- [ ] **Step 1: Move the teacher-requests files**

```bash
mkdir -p apps/admin/src/app/\(dashboard\)/teacher-requests
git mv apps/admin/src/app/teacher-requests/page.tsx apps/admin/src/app/\(dashboard\)/teacher-requests/page.tsx
git mv apps/admin/src/app/teacher-requests/actions.ts apps/admin/src/app/\(dashboard\)/teacher-requests/actions.ts
git mv apps/admin/src/app/teacher-requests/approve-reject-buttons.tsx apps/admin/src/app/\(dashboard\)/teacher-requests/approve-reject-buttons.tsx
```

- [ ] **Step 2: Write `Sidebar`**

```tsx
// apps/admin/src/components/sidebar.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "Dashboard", href: "/" },
  { label: "Series", href: "/series" },
  { label: "Episodes", href: "/episodes" },
  { label: "Destinations", href: "/destinations" },
  { label: "Contributors", href: "/contributors" },
  { label: "Consents", href: "/consents" },
  { label: "Source Materials", href: "/source-materials" },
  { label: "Inquiries", href: "/inquiries" },
  { label: "Teachers", href: "/teacher-requests" },
  { label: "Users", href: "/users" },
  { label: "Settings", href: "/settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav className="flex w-56 flex-shrink-0 flex-col gap-1 border-r border-gray-200 bg-gray-50 p-4">
      {NAV_ITEMS.map((item) => {
        const isActive = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`rounded px-3 py-2 text-sm ${
              isActive ? "bg-[#1F3B2C] text-white" : "text-gray-700 hover:bg-gray-200"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 3: Write `TopBar`**

```tsx
// apps/admin/src/components/top-bar.tsx
"use client";

import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

export function TopBar({ adminName }: { adminName: string }) {
  const router = useRouter();

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/sign-in");
    router.refresh();
  };

  return (
    <header className="flex items-center justify-end gap-4 border-b border-gray-200 px-6 py-3">
      <span className="text-sm text-gray-700">{adminName}</span>
      <button onClick={handleSignOut} className="text-sm font-medium text-red-700 hover:underline">
        Sign Out
      </button>
    </header>
  );
}
```

- [ ] **Step 4: Write the `(dashboard)` layout**

```tsx
// apps/admin/src/app/(dashboard)/layout.tsx
import { Sidebar } from "@/components/sidebar";
import { TopBar } from "@/components/top-bar";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let adminName = "";
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();
    adminName = profile?.display_name ?? user.email ?? "";
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar adminName={adminName} />
        <main className="flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
```

`proxy.ts` already keeps non-admins off every route except `/sign-in` and `/not-authorized`, so this layout doesn't need its own separate auth check — the `getUser()` call here is only to display the admin's name, not to gate access.

- [ ] **Step 5: Write the dashboard overview page**

```tsx
// apps/admin/src/app/(dashboard)/page.tsx
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [seriesCount, publishedSeriesCount, episodeCount, publishedEpisodeCount] =
    await Promise.all([
      supabase.from("series").select("*", { count: "exact", head: true }),
      supabase.from("series").select("*", { count: "exact", head: true }).eq("is_published", true),
      supabase.from("episodes").select("*", { count: "exact", head: true }),
      supabase
        .from("episodes")
        .select("*", { count: "exact", head: true })
        .eq("status", "published"),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Series</p>
          <p className="text-2xl font-semibold">{seriesCount.count ?? 0}</p>
          <p className="text-xs text-gray-400">{publishedSeriesCount.count ?? 0} published</p>
        </div>
        <div className="rounded border border-gray-200 p-4">
          <p className="text-sm text-gray-500">Episodes</p>
          <p className="text-2xl font-semibold">{episodeCount.count ?? 0}</p>
          <p className="text-xs text-gray-400">{publishedEpisodeCount.count ?? 0} published</p>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Delete the default template page**

```bash
git rm apps/admin/src/app/page.tsx
```

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 8: Manually verify** — run `pnpm --filter admin dev`, sign in as an admin, confirm `/` shows the dashboard overview, `/teacher-requests` still works and is reachable from the sidebar, and the sidebar highlights the active item.

- [ ] **Step 9: Commit**

```bash
git add apps/admin/src/components/sidebar.tsx apps/admin/src/components/top-bar.tsx "apps/admin/src/app/(dashboard)/layout.tsx" "apps/admin/src/app/(dashboard)/page.tsx" "apps/admin/src/app/(dashboard)/teacher-requests"
git commit -m "Prompt 14: add dashboard layout (sidebar, top bar), move teacher-requests into it"
```

---

### Task 7: Placeholder pages

**Files:**

- Create: `apps/admin/src/components/placeholder-page.tsx`
- Create: `apps/admin/src/app/(dashboard)/contributors/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/consents/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/source-materials/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/inquiries/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/users/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/settings/page.tsx`

**Interfaces:**

- Produces: `PlaceholderPage({ title, note }: { title: string; note: string })`.

These six sidebar items have no real page in this prompt (Contributors/Consents/Source Materials/Inquiries are Prompt 15's scope; Users/Settings are unscoped in either prompt) — each gets a real route so the sidebar link doesn't dead-end or 404.

- [ ] **Step 1: Write `PlaceholderPage`**

```tsx
// apps/admin/src/components/placeholder-page.tsx
export function PlaceholderPage({ title, note }: { title: string; note: string }) {
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-gray-500">{note}</p>
    </div>
  );
}
```

- [ ] **Step 2: Write the six placeholder pages**

```tsx
// apps/admin/src/app/(dashboard)/contributors/page.tsx
import { PlaceholderPage } from "@/components/placeholder-page";

export default function ContributorsPage() {
  return <PlaceholderPage title="Contributors" note="Coming in Prompt 15." />;
}
```

```tsx
// apps/admin/src/app/(dashboard)/consents/page.tsx
import { PlaceholderPage } from "@/components/placeholder-page";

export default function ConsentsPage() {
  return <PlaceholderPage title="Consents" note="Coming in Prompt 15." />;
}
```

```tsx
// apps/admin/src/app/(dashboard)/source-materials/page.tsx
import { PlaceholderPage } from "@/components/placeholder-page";

export default function SourceMaterialsPage() {
  return <PlaceholderPage title="Source Materials" note="Coming in Prompt 15." />;
}
```

```tsx
// apps/admin/src/app/(dashboard)/inquiries/page.tsx
import { PlaceholderPage } from "@/components/placeholder-page";

export default function InquiriesPage() {
  return <PlaceholderPage title="Inquiries" note="Coming in Prompt 15." />;
}
```

```tsx
// apps/admin/src/app/(dashboard)/users/page.tsx
import { PlaceholderPage } from "@/components/placeholder-page";

export default function UsersPage() {
  return <PlaceholderPage title="Users" note="Coming soon." />;
}
```

```tsx
// apps/admin/src/app/(dashboard)/settings/page.tsx
import { PlaceholderPage } from "@/components/placeholder-page";

export default function SettingsPage() {
  return <PlaceholderPage title="Settings" note="Coming soon." />;
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/components/placeholder-page.tsx "apps/admin/src/app/(dashboard)/contributors" "apps/admin/src/app/(dashboard)/consents" "apps/admin/src/app/(dashboard)/source-materials" "apps/admin/src/app/(dashboard)/inquiries" "apps/admin/src/app/(dashboard)/users" "apps/admin/src/app/(dashboard)/settings"
git commit -m "Prompt 14: add placeholder pages for unbuilt sidebar items"
```

---

### Task 8: Series validation schema + Server Actions

**Files:**

- Modify: `apps/admin/src/lib/validation.ts`
- Create: `apps/admin/src/app/(dashboard)/series/actions.ts`

**Interfaces:**

- Consumes: `requireAdmin` (Task 3), `logAdminAction` (Task 3).
- Produces: `seriesSchema`, `SeriesInput` type; `createSeries(input: SeriesInput): Promise<ActionResult>`, `updateSeries(id: string, input: SeriesInput): Promise<ActionResult>`, `deleteSeries(id: string): Promise<ActionResult>`, `toggleSeriesPublish(id: string, isPublished: boolean): Promise<ActionResult>`. Consumed by Task 9 (`SeriesForm`) and Task 10 (list page).

- [ ] **Step 1: Add the series schema**

Append to `apps/admin/src/lib/validation.ts`:

```ts
export const seriesSchema = z.object({
  title: z.string().trim().min(1, "Title is required"),
  slug: z.string().trim().min(1, "Slug is required"),
  description: z.string().trim().optional(),
  category: z.string().trim().optional(),
  destinationId: z.string().uuid().optional().or(z.literal("")),
  coverImageUrl: z.string().optional(),
  isFeatured: z.boolean(),
  isPublished: z.boolean(),
});
export type SeriesInput = z.infer<typeof seriesSchema>;
```

- [ ] **Step 2: Write the Series Server Actions**

```ts
// apps/admin/src/app/(dashboard)/series/actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import type { SeriesInput } from "@/lib/validation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

function toRow(input: SeriesInput) {
  return {
    title: input.title,
    slug: input.slug,
    description: input.description || null,
    category: input.category || null,
    destination_id: input.destinationId || null,
    cover_image_url: input.coverImageUrl || null,
    is_featured: input.isFeatured,
    is_published: input.isPublished,
  };
}

export async function createSeries(input: SeriesInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.from("series").insert(toRow(input)).select("id").single();
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "create", "series", data.id, { title: input.title });
  revalidatePath("/series");
  return { ok: true };
}

export async function updateSeries(id: string, input: SeriesInput): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("series").update(toRow(input)).eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "update", "series", id, { title: input.title });
  revalidatePath("/series");
  return { ok: true };
}

export async function deleteSeries(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("series").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "delete", "series", id);
  revalidatePath("/series");
  return { ok: true };
}

export async function toggleSeriesPublish(id: string, isPublished: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("series")
    .update({ is_published: isPublished })
    .eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, isPublished ? "publish" : "unpublish", "series", id);
  revalidatePath("/series");
  return { ok: true };
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/validation.ts "apps/admin/src/app/(dashboard)/series/actions.ts"
git commit -m "Prompt 14: add series validation schema and server actions"
```

---

### Task 9: `SeriesForm`

**Files:**

- Create: `apps/admin/src/app/(dashboard)/series/series-form.tsx`

**Interfaces:**

- Consumes: `seriesSchema`/`SeriesInput` (Task 8), `createSeries`/`updateSeries` (Task 8), `slugify` (Task 2), `Button`/`TextInput`/`Textarea`/`Select`/`Toggle` (Task 4).
- Produces: `SeriesForm({ series, destinations }: { series?: SeriesRow; destinations: DestinationOption[] })`. Consumed by Task 10's new/edit pages.

- [ ] **Step 1: Write `SeriesForm`**

```tsx
// apps/admin/src/app/(dashboard)/series/series-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/button";
import { Select } from "@/components/select";
import { Textarea } from "@/components/textarea";
import { TextInput } from "@/components/text-input";
import { Toggle } from "@/components/toggle";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/slugify";
import { type SeriesInput, seriesSchema } from "@/lib/validation";

import { createSeries, updateSeries } from "./actions";

export type SeriesRow = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  category: string | null;
  destination_id: string | null;
  cover_image_url: string | null;
  is_featured: boolean;
  is_published: boolean;
};

export type DestinationOption = { id: string; name: string };

export function SeriesForm({
  series,
  destinations,
}: {
  series?: SeriesRow;
  destinations: DestinationOption[];
}) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const slugTouchedRef = useRef(series ? true : false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SeriesInput>({
    resolver: zodResolver(seriesSchema),
    defaultValues: {
      title: series?.title ?? "",
      slug: series?.slug ?? "",
      description: series?.description ?? "",
      category: series?.category ?? "",
      destinationId: series?.destination_id ?? "",
      coverImageUrl: series?.cover_image_url ?? "",
      isFeatured: series?.is_featured ?? false,
      isPublished: series?.is_published ?? false,
    },
  });

  const title = watch("title");

  const handleTitleChange = (value: string) => {
    setValue("title", value);
    if (!slugTouchedRef.current) {
      setValue("slug", slugify(value));
    }
  };

  const handleSlugChange = (value: string) => {
    slugTouchedRef.current = true;
    setValue("slug", value);
  };

  const handleCoverUpload = async (file: File) => {
    setUploading(true);
    setApiError(undefined);
    const supabase = createClient();
    const path = `series/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("images").upload(path, file);
    if (uploadError) {
      setApiError(uploadError.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("images").getPublicUrl(path);
    setValue("coverImageUrl", data.publicUrl);
    setUploading(false);
  };

  const onSubmit = async (values: SeriesInput) => {
    setApiError(undefined);
    const result = series ? await updateSeries(series.id, values) : await createSeries(values);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.push("/series");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-3">
      <label className="flex flex-col gap-1">
        Title
        <TextInput
          {...register("title")}
          onChange={(e) => handleTitleChange(e.target.value)}
          value={title}
        />
        {errors.title && <p className="text-sm text-red-600">{errors.title.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Slug
        <TextInput {...register("slug")} onChange={(e) => handleSlugChange(e.target.value)} />
        {errors.slug && <p className="text-sm text-red-600">{errors.slug.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Description
        <Textarea {...register("description")} rows={3} />
      </label>

      <label className="flex flex-col gap-1">
        Category
        <TextInput {...register("category")} placeholder="e.g. lakes, forests, elder_history" />
      </label>

      <label className="flex flex-col gap-1">
        Destination
        <Select {...register("destinationId")}>
          <option value="">None</option>
          {destinations.map((destination) => (
            <option key={destination.id} value={destination.id}>
              {destination.name}
            </option>
          ))}
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Cover Image
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleCoverUpload(file);
            }
          }}
        />
        {uploading && <p className="text-sm text-gray-500">Uploading…</p>}
      </label>

      <Toggle label="Featured" {...register("isFeatured")} />
      <Toggle label="Published" {...register("isPublished")} />

      {apiError && <p className="text-sm text-red-600">{apiError}</p>}

      <Button type="submit" disabled={isSubmitting || uploading}>
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/series/series-form.tsx"
git commit -m "Prompt 14: add SeriesForm"
```

---

### Task 10: Series list, new, and edit pages

**Files:**

- Create: `apps/admin/src/app/(dashboard)/series/series-table.tsx`
- Create: `apps/admin/src/app/(dashboard)/series/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/series/new/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/series/[id]/edit/page.tsx`

**Interfaces:**

- Consumes: `DataTable` (Task 5), `SeriesForm`/`SeriesRow`/`DestinationOption` (Task 9), `deleteSeries`/`toggleSeriesPublish` (Task 8).

- [ ] **Step 1: Write `SeriesTable`**

```tsx
// apps/admin/src/app/(dashboard)/series/series-table.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/button";
import { DataTable } from "@/components/data-table";

import { deleteSeries, toggleSeriesPublish } from "./actions";
import type { SeriesRow } from "./series-form";

export function SeriesTable({ series }: { series: SeriesRow[] }) {
  const router = useRouter();

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this series? This cannot be undone.")) {
      return;
    }
    await deleteSeries(id);
    router.refresh();
  };

  const handleTogglePublish = async (row: SeriesRow) => {
    await toggleSeriesPublish(row.id, !row.is_published);
    router.refresh();
  };

  return (
    <DataTable
      rows={series}
      getRowKey={(row) => row.id}
      searchPlaceholder="Search by title, category, or slug…"
      filterRow={(row, query) =>
        row.title.toLowerCase().includes(query) ||
        (row.category ?? "").toLowerCase().includes(query) ||
        row.slug.toLowerCase().includes(query)
      }
      columns={[
        { header: "Title", cell: (row) => row.title },
        { header: "Category", cell: (row) => row.category ?? "—" },
        { header: "Slug", cell: (row) => row.slug },
        { header: "Status", cell: (row) => (row.is_published ? "Published" : "Draft") },
        {
          header: "Actions",
          cell: (row) => (
            <div className="flex gap-2">
              <Link
                href={`/series/${row.id}/edit`}
                className="text-sm text-blue-700 hover:underline"
              >
                Edit
              </Link>
              <button
                onClick={() => void handleTogglePublish(row)}
                className="text-sm text-blue-700 hover:underline"
              >
                {row.is_published ? "Unpublish" : "Publish"}
              </button>
              <button
                onClick={() => void handleDelete(row.id)}
                className="text-sm text-red-700 hover:underline"
              >
                Delete
              </button>
            </div>
          ),
        },
      ]}
    />
  );
}
```

- [ ] **Step 2: Write the list page**

```tsx
// apps/admin/src/app/(dashboard)/series/page.tsx
import Link from "next/link";

import { Button } from "@/components/button";
import { createClient } from "@/lib/supabase/server";

import { SeriesTable } from "./series-table";

export default async function SeriesPage() {
  const supabase = await createClient();
  const { data: series, error } = await supabase
    .from("series")
    .select(
      "id, title, slug, description, category, destination_id, cover_image_url, is_featured, is_published",
    )
    .order("title", { ascending: true });

  if (error) {
    return <p className="text-red-600">Failed to load series: {error.message}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Series</h1>
        <Link href="/series/new">
          <Button>New Series</Button>
        </Link>
      </div>
      <SeriesTable series={series} />
    </div>
  );
}
```

- [ ] **Step 3: Write the new page**

```tsx
// apps/admin/src/app/(dashboard)/series/new/page.tsx
import { createClient } from "@/lib/supabase/server";

import { SeriesForm } from "../series-form";

export default async function NewSeriesPage() {
  const supabase = await createClient();
  const { data: destinations } = await supabase
    .from("destinations")
    .select("id, name")
    .order("name");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New Series</h1>
      <SeriesForm destinations={destinations ?? []} />
    </div>
  );
}
```

- [ ] **Step 4: Write the edit page**

```tsx
// apps/admin/src/app/(dashboard)/series/[id]/edit/page.tsx
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { SeriesForm } from "../../series-form";

export default async function EditSeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [seriesResult, destinationsResult] = await Promise.all([
    supabase
      .from("series")
      .select(
        "id, title, slug, description, category, destination_id, cover_image_url, is_featured, is_published",
      )
      .eq("id", id)
      .single(),
    supabase.from("destinations").select("id, name").order("name"),
  ]);

  if (seriesResult.error || !seriesResult.data) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Edit Series</h1>
      <SeriesForm series={seriesResult.data} destinations={destinationsResult.data ?? []} />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Manually verify** — run `pnpm --filter admin dev`, create a series, confirm the slug auto-fills from the title until manually edited, upload a cover image, toggle featured/published, edit it, delete it, and confirm each write shows up in `admin_actions` (query it directly via the Supabase SQL editor or CLI).

- [ ] **Step 7: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/series/series-table.tsx" "apps/admin/src/app/(dashboard)/series/page.tsx" "apps/admin/src/app/(dashboard)/series/new" "apps/admin/src/app/(dashboard)/series/[id]"
git commit -m "Prompt 14: add series list, new, and edit pages"
```

---

### Task 11: Episode validation schema + core Server Actions

**Files:**

- Modify: `apps/admin/src/lib/validation.ts`
- Create: `apps/admin/src/app/(dashboard)/episodes/actions.ts`

**Interfaces:**

- Consumes: `requireAdmin`, `logAdminAction` (Task 3).
- Produces: `episodeSchema`, `EpisodeInput` type; `ContributorLink` type; `createEpisode(input: EpisodeInput, contributorLinks: ContributorLink[]): Promise<ActionResult>`, `updateEpisode(id: string, input: EpisodeInput, contributorLinks: ContributorLink[]): Promise<ActionResult>`, `deleteEpisode(id: string): Promise<ActionResult>`. Consumed by Task 14 (`ContributorLinker`, which imports the `ContributorLink` type), Task 15 (`EpisodeForm`), Task 17 (list page).

- [ ] **Step 1: Add the episode schema**

Append to `apps/admin/src/lib/validation.ts`:

```ts
export const episodeSchema = z.object({
  seriesId: z.string().uuid("Select a series"),
  episodeNumber: z.coerce.number().int().positive("Episode number must be a positive integer"),
  title: z.string().trim().min(1, "Title is required"),
  description: z.string().trim().optional(),
  language: z.enum(["en", "lg", "sw", "fr", "rw"]),
  accessTier: z.enum(["free", "coins", "premium"]),
  coinPrice: z.coerce.number().int().min(0).default(0),
  contentSource: z.enum([
    "elder_testimony",
    "narrated_production",
    "ai_assisted",
    "tour_guide_original",
  ]),
  subjectArea: z
    .enum(["history", "biology", "geography", "culture", "conservation", "folklore"])
    .optional()
    .or(z.literal("")),
  gradeLevel: z
    .enum(["primary", "o_level", "a_level", "tertiary", "general"])
    .optional()
    .or(z.literal("")),
  syllabusTopic: z.string().trim().optional(),
  sourceMaterialId: z.string().uuid().optional().or(z.literal("")),
  audioUrl: z.string().optional(),
  durationSeconds: z.coerce.number().int().positive().optional(),
});
export type EpisodeInput = z.infer<typeof episodeSchema>;
```

- [ ] **Step 2: Write the core Episode Server Actions**

```ts
// apps/admin/src/app/(dashboard)/episodes/actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import type { EpisodeInput } from "@/lib/validation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

export type ContributorLink = { contributorId: string; role: string };

function toRow(input: EpisodeInput) {
  return {
    series_id: input.seriesId,
    episode_number: input.episodeNumber,
    title: input.title,
    description: input.description || null,
    language: input.language,
    access_tier: input.accessTier,
    coin_price: input.coinPrice,
    content_source: input.contentSource,
    subject_area: input.subjectArea || null,
    grade_level: input.gradeLevel || null,
    syllabus_topic: input.syllabusTopic || null,
    source_material_id: input.sourceMaterialId || null,
    audio_url: input.audioUrl || null,
    duration_seconds: input.durationSeconds ?? null,
  };
}

async function replaceContributorLinks(
  supabase: ReturnType<typeof createServiceRoleClient>,
  episodeId: string,
  links: ContributorLink[],
): Promise<{ error: string | null }> {
  const { error: deleteError } = await supabase
    .from("episode_contributors")
    .delete()
    .eq("episode_id", episodeId);
  if (deleteError) {
    return { error: deleteError.message };
  }
  if (links.length === 0) {
    return { error: null };
  }
  const { error: insertError } = await supabase.from("episode_contributors").insert(
    links.map((link) => ({
      episode_id: episodeId,
      contributor_id: link.contributorId,
      role: link.role,
    })),
  );
  return { error: insertError?.message ?? null };
}

export async function createEpisode(
  input: EpisodeInput,
  contributorLinks: ContributorLink[],
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("episodes")
    .insert(toRow(input))
    .select("id")
    .single();
  if (error) {
    return { ok: false, message: error.message };
  }

  const linkResult = await replaceContributorLinks(supabase, data.id, contributorLinks);
  if (linkResult.error) {
    return { ok: false, message: linkResult.error };
  }

  await logAdminAction(admin.adminId, "create", "episode", data.id, { title: input.title });
  revalidatePath("/episodes");
  return { ok: true };
}

export async function updateEpisode(
  id: string,
  input: EpisodeInput,
  contributorLinks: ContributorLink[],
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("episodes").update(toRow(input)).eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  const linkResult = await replaceContributorLinks(supabase, id, contributorLinks);
  if (linkResult.error) {
    return { ok: false, message: linkResult.error };
  }

  await logAdminAction(admin.adminId, "update", "episode", id, { title: input.title });
  revalidatePath("/episodes");
  return { ok: true };
}

export async function deleteEpisode(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("episodes").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "delete", "episode", id);
  revalidatePath("/episodes");
  return { ok: true };
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/validation.ts "apps/admin/src/app/(dashboard)/episodes/actions.ts"
git commit -m "Prompt 14: add episode validation schema and core server actions"
```

---

### Task 12: `checkPublishRequirements` — pure publish-validation logic

**Files:**

- Create: `apps/admin/src/app/(dashboard)/episodes/check-publish-requirements.ts`
- Test: `apps/admin/src/app/(dashboard)/episodes/check-publish-requirements.test.ts`

**Interfaces:**

- Produces: `PublishCheck = { label: string; passed: boolean; reason?: string }`; `EpisodeForPublishCheck`, `ContributorConsentInfo` types; `checkPublishRequirements(episode: EpisodeForPublishCheck, linkedContributors: ContributorConsentInfo[]): PublishCheck[]`. Consumed by Task 13 (`validateEpisodeForPublish`).

This is the one genuinely valuable piece of pure logic in the episode publish flow — kept separate from the Supabase fetch that assembles its inputs specifically so it can be unit tested without a live database, mirroring this codebase's existing `applyListeningTick`/`resolveResumePosition` precedent of extracting pure decision logic away from I/O.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/admin/src/app/(dashboard)/episodes/check-publish-requirements.test.ts
import { describe, expect, it } from "vitest";

import { checkPublishRequirements } from "./check-publish-requirements";

const baseEpisode = {
  audioUrl: "https://example.com/audio.mp3",
  title: "The Lake's First Story",
  description: "A story about the lake.",
  contentSource: "narrated_production",
};

describe("checkPublishRequirements", () => {
  it("passes all checks for a fully valid narrated-production episode", () => {
    const checks = checkPublishRequirements(baseEpisode, []);
    expect(checks.every((check) => check.passed)).toBe(true);
  });

  it("fails the audio check when audioUrl is null", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, audioUrl: null }, []);
    const audioCheck = checks.find((check) => check.label === "Audio file uploaded");
    expect(audioCheck?.passed).toBe(false);
    expect(audioCheck?.reason).toMatch(/no audio file/i);
  });

  it("fails the title/description check when title is empty", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, title: "" }, []);
    const check = checks.find((check) => check.label === "Title and description present");
    expect(check?.passed).toBe(false);
  });

  it("fails the title/description check when description is null", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, description: null }, []);
    const check = checks.find((check) => check.label === "Title and description present");
    expect(check?.passed).toBe(false);
  });

  it("does not add an elder-consent check for non-elder-testimony episodes", () => {
    const checks = checkPublishRequirements(baseEpisode, []);
    expect(checks.find((check) => check.label === "Elder testimony consent")).toBeUndefined();
  });

  it("fails the elder-consent check when no contributor is linked", () => {
    const checks = checkPublishRequirements(
      { ...baseEpisode, contentSource: "elder_testimony" },
      [],
    );
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(false);
  });

  it("fails the elder-consent check when a linked contributor is not an elder", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "translator", consentStatuses: ["granted"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(false);
  });

  it("fails the elder-consent check when the elder's consent is granted_with_conditions, not granted", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "elder", consentStatuses: ["granted_with_conditions"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(false);
  });

  it("fails the elder-consent check when the elder has a declined consent and no granted one", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "elder", consentStatuses: ["declined"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(false);
  });

  it("passes the elder-consent check when a linked elder has a granted story_recording consent", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "elder", consentStatuses: ["granted"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(true);
  });

  it("passes the elder-consent check when one of several linked contributors is a consented elder", () => {
    const checks = checkPublishRequirements({ ...baseEpisode, contentSource: "elder_testimony" }, [
      { contributorType: "translator", consentStatuses: ["granted"] },
      { contributorType: "elder", consentStatuses: ["declined", "granted"] },
    ]);
    const check = checks.find((check) => check.label === "Elder testimony consent");
    expect(check?.passed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/admin && npx vitest run check-publish-requirements.test.ts
```

Expected: FAIL — `check-publish-requirements.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// apps/admin/src/app/(dashboard)/episodes/check-publish-requirements.ts

export type PublishCheck = { label: string; passed: boolean; reason?: string };

export type EpisodeForPublishCheck = {
  audioUrl: string | null;
  title: string;
  description: string | null;
  contentSource: string;
};

export type ContributorConsentInfo = {
  contributorType: string;
  /** consent_status values for this contributor's story_recording consents only. */
  consentStatuses: string[];
};

// Pure decision logic, kept separate from the Supabase fetch that
// assembles `linkedContributors` so it can be unit tested directly —
// mirrors this codebase's applyListeningTick/resolveResumePosition
// precedent of extracting pure logic away from I/O.
export function checkPublishRequirements(
  episode: EpisodeForPublishCheck,
  linkedContributors: ContributorConsentInfo[],
): PublishCheck[] {
  const checks: PublishCheck[] = [];

  const hasAudio = episode.audioUrl !== null && episode.audioUrl.length > 0;
  checks.push({
    label: "Audio file uploaded",
    passed: hasAudio,
    reason: hasAudio ? undefined : "No audio file has been uploaded for this episode.",
  });

  const hasTitleAndDescription =
    episode.title.trim().length > 0 && (episode.description ?? "").trim().length > 0;
  checks.push({
    label: "Title and description present",
    passed: hasTitleAndDescription,
    reason: hasTitleAndDescription
      ? undefined
      : "Both a title and a description are required before publishing.",
  });

  if (episode.contentSource === "elder_testimony") {
    const hasGrantedElderConsent = linkedContributors.some(
      (contributor) =>
        contributor.contributorType === "elder" && contributor.consentStatuses.includes("granted"),
    );
    checks.push({
      label: "Elder testimony consent",
      passed: hasGrantedElderConsent,
      reason: hasGrantedElderConsent
        ? undefined
        : "This episode is marked as elder testimony but has no linked elder contributor with a granted story_recording consent. Link an elder contributor and record their consent before publishing.",
    });
  }

  return checks;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/admin && npx vitest run check-publish-requirements.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/episodes/check-publish-requirements.ts" "apps/admin/src/app/(dashboard)/episodes/check-publish-requirements.test.ts"
git commit -m "Prompt 14: add checkPublishRequirements with tested elder-consent logic"
```

---

### Task 13: Publish/unpublish Server Actions

**Files:**

- Create: `apps/admin/src/app/(dashboard)/episodes/publish-actions.ts`

**Interfaces:**

- Consumes: `checkPublishRequirements`, `PublishCheck` (Task 12), `requireAdmin`, `logAdminAction` (Task 3).
- Produces: `validateEpisodeForPublish(episodeId: string): Promise<PublishCheck[]>`, `publishEpisode(episodeId: string): Promise<ActionResult>`, `unpublishEpisode(episodeId: string): Promise<ActionResult>`. Consumed by Task 16 (`PublishGuardPanel`).

`validateEpisodeForPublish` is read-only — it fetches the episode and its linked contributors' consents, runs the pure check, and returns the results. It does not call `logAdminAction` (nothing is mutated). `publishEpisode` re-runs the same validation server-side before writing — never trust that the client-shown checks are still true by the time "Confirm Publish" is clicked (an admin could have this page open in two tabs, or the underlying data could change between the check and the click).

- [ ] **Step 1: Write the publish actions**

```ts
// apps/admin/src/app/(dashboard)/episodes/publish-actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import {
  type ContributorConsentInfo,
  checkPublishRequirements,
  type PublishCheck,
} from "./check-publish-requirements";

export type ActionResult = { ok: true } | { ok: false; message: string };

type EpisodeContributorRow = {
  contributors: { contributor_type: string } | null;
};

type ConsentRow = { contributor_id: string; consent_status: string };

async function loadPublishCheckInputs(
  supabase: ReturnType<typeof createServiceRoleClient>,
  episodeId: string,
): Promise<
  | {
      ok: true;
      episode: {
        audioUrl: string | null;
        title: string;
        description: string | null;
        contentSource: string;
      };
      linkedContributors: ContributorConsentInfo[];
    }
  | { ok: false; message: string }
> {
  const { data: episode, error: episodeError } = await supabase
    .from("episodes")
    .select("audio_url, title, description, content_source")
    .eq("id", episodeId)
    .single();
  if (episodeError || !episode) {
    return { ok: false, message: episodeError?.message ?? "Episode not found." };
  }

  const { data: links, error: linksError } = await supabase
    .from("episode_contributors")
    .select("contributor_id, contributors(contributor_type)")
    .eq("episode_id", episodeId)
    .returns<(EpisodeContributorRow & { contributor_id: string })[]>();
  if (linksError) {
    return { ok: false, message: linksError.message };
  }

  const contributorIds = links.map((link) => link.contributor_id);
  let consentsByContributor = new Map<string, string[]>();
  if (contributorIds.length > 0) {
    const { data: consents, error: consentsError } = await supabase
      .from("consents")
      .select("contributor_id, consent_status")
      .eq("consent_type", "story_recording")
      .in("contributor_id", contributorIds)
      .returns<ConsentRow[]>();
    if (consentsError) {
      return { ok: false, message: consentsError.message };
    }
    consentsByContributor = consents.reduce((map, row) => {
      const existing = map.get(row.contributor_id) ?? [];
      existing.push(row.consent_status);
      map.set(row.contributor_id, existing);
      return map;
    }, new Map<string, string[]>());
  }

  const linkedContributors: ContributorConsentInfo[] = links.map((link) => ({
    contributorType: link.contributors?.contributor_type ?? "",
    consentStatuses: consentsByContributor.get(link.contributor_id) ?? [],
  }));

  return {
    ok: true,
    episode: {
      audioUrl: episode.audio_url,
      title: episode.title,
      description: episode.description,
      contentSource: episode.content_source,
    },
    linkedContributors,
  };
}

export async function validateEpisodeForPublish(episodeId: string): Promise<PublishCheck[]> {
  const supabase = createServiceRoleClient();
  const inputs = await loadPublishCheckInputs(supabase, episodeId);
  if (!inputs.ok) {
    return [{ label: "Load episode data", passed: false, reason: inputs.message }];
  }
  return checkPublishRequirements(inputs.episode, inputs.linkedContributors);
}

export async function publishEpisode(episodeId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const inputs = await loadPublishCheckInputs(supabase, episodeId);
  if (!inputs.ok) {
    return { ok: false, message: inputs.message };
  }
  const checks = checkPublishRequirements(inputs.episode, inputs.linkedContributors);
  const failedCheck = checks.find((check) => !check.passed);
  if (failedCheck) {
    return { ok: false, message: failedCheck.reason ?? `Failed check: ${failedCheck.label}` };
  }

  const { error } = await supabase
    .from("episodes")
    .update({ status: "published", published_at: new Date().toISOString() })
    .eq("id", episodeId);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "publish", "episode", episodeId);
  revalidatePath("/episodes");
  return { ok: true };
}

export async function unpublishEpisode(episodeId: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("episodes").update({ status: "draft" }).eq("id", episodeId);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "unpublish", "episode", episodeId);
  revalidatePath("/episodes");
  return { ok: true };
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/episodes/publish-actions.ts"
git commit -m "Prompt 14: add publish/unpublish server actions with re-validation"
```

---

### Task 14: `ContributorLinker`

**Files:**

- Create: `apps/admin/src/app/(dashboard)/episodes/contributor-linker.tsx`

**Interfaces:**

- Consumes: `ContributorLink` (Task 11), `Button`/`TextInput`/`Select` (Task 4).
- Produces: `ContributorLinker({ options, links, onChange }: ContributorLinkerProps)`, `ContributorOption` type. Consumed by Task 15 (`EpisodeForm`).

A searchable select-and-add UI: pick a contributor from a dropdown, type a role, add it to the list; each added row can be removed. State lives entirely in the parent `EpisodeForm` (via `links`/`onChange`) so the whole set gets submitted together with the rest of the form — matches the "full replace on save" design from the spec.

- [ ] **Step 1: Write `ContributorLinker`**

```tsx
// apps/admin/src/app/(dashboard)/episodes/contributor-linker.tsx
"use client";

import { useState } from "react";

import { Button } from "@/components/button";
import { Select } from "@/components/select";
import { TextInput } from "@/components/text-input";

import type { ContributorLink } from "./actions";

export type ContributorOption = { id: string; display_name: string; contributor_type: string };

export function ContributorLinker({
  options,
  links,
  onChange,
}: {
  options: ContributorOption[];
  links: ContributorLink[];
  onChange: (links: ContributorLink[]) => void;
}) {
  const [selectedContributorId, setSelectedContributorId] = useState("");
  const [role, setRole] = useState("");

  const handleAdd = () => {
    if (!selectedContributorId || !role.trim()) {
      return;
    }
    onChange([...links, { contributorId: selectedContributorId, role: role.trim() }]);
    setSelectedContributorId("");
    setRole("");
  };

  const handleRemove = (index: number) => {
    onChange(links.filter((_, i) => i !== index));
  };

  const optionsById = new Map(options.map((option) => [option.id, option]));

  return (
    <div className="flex flex-col gap-2">
      <span>Contributors</span>
      {links.length > 0 && (
        <ul className="flex flex-col gap-1">
          {links.map((link, index) => (
            <li
              key={`${link.contributorId}-${link.role}-${index}`}
              className="flex items-center gap-2"
            >
              <span>
                {optionsById.get(link.contributorId)?.display_name ?? link.contributorId} —{" "}
                {link.role}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(index)}
                className="text-sm text-red-700 hover:underline"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Select
          value={selectedContributorId}
          onChange={(e) => setSelectedContributorId(e.target.value)}
        >
          <option value="">Select a contributor</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.display_name} ({option.contributor_type})
            </option>
          ))}
        </Select>
        <TextInput
          placeholder="Role (e.g. narrator)"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        />
        <Button type="button" variant="secondary" onClick={handleAdd}>
          Add
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/episodes/contributor-linker.tsx"
git commit -m "Prompt 14: add ContributorLinker"
```

---

### Task 15: `EpisodeForm` (fields + audio upload)

**Files:**

- Create: `apps/admin/src/app/(dashboard)/episodes/episode-form.tsx`

**Interfaces:**

- Consumes: `episodeSchema`/`EpisodeInput` (Task 11), `createEpisode`/`updateEpisode` (Task 11), `ContributorLinker` (Task 14), `Button`/`TextInput`/`Textarea`/`Select` (Task 4).
- Produces: `EpisodeForm({ episode, seriesOptions, sourceMaterialOptions, contributorOptions, existingLinks }: EpisodeFormProps)`. Consumed by Task 17's new/edit pages.

- [ ] **Step 1: Write `EpisodeForm`**

```tsx
// apps/admin/src/app/(dashboard)/episodes/episode-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/button";
import { Select } from "@/components/select";
import { Textarea } from "@/components/textarea";
import { TextInput } from "@/components/text-input";
import { createClient } from "@/lib/supabase/client";
import { type EpisodeInput, episodeSchema } from "@/lib/validation";

import { createEpisode, type ContributorLink, updateEpisode } from "./actions";
import { ContributorLinker, type ContributorOption } from "./contributor-linker";

export type EpisodeRow = {
  id: string;
  series_id: string;
  episode_number: number;
  title: string;
  description: string | null;
  language: string;
  access_tier: string;
  coin_price: number;
  content_source: string;
  subject_area: string | null;
  grade_level: string | null;
  syllabus_topic: string | null;
  source_material_id: string | null;
  audio_url: string | null;
  duration_seconds: number | null;
};

export type SeriesOption = { id: string; title: string };
export type SourceMaterialOption = { id: string; title: string; public_domain_verified: boolean };

export function EpisodeForm({
  episode,
  seriesOptions,
  sourceMaterialOptions,
  contributorOptions,
  existingLinks,
}: {
  episode?: EpisodeRow;
  seriesOptions: SeriesOption[];
  sourceMaterialOptions: SourceMaterialOption[];
  contributorOptions: ContributorOption[];
  existingLinks: ContributorLink[];
}) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const [links, setLinks] = useState<ContributorLink[]>(existingLinks);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<EpisodeInput>({
    resolver: zodResolver(episodeSchema),
    defaultValues: {
      seriesId: episode?.series_id ?? "",
      episodeNumber: episode?.episode_number ?? 1,
      title: episode?.title ?? "",
      description: episode?.description ?? "",
      language: (episode?.language as EpisodeInput["language"]) ?? "en",
      accessTier: (episode?.access_tier as EpisodeInput["accessTier"]) ?? "free",
      coinPrice: episode?.coin_price ?? 0,
      contentSource:
        (episode?.content_source as EpisodeInput["contentSource"]) ?? "narrated_production",
      subjectArea: (episode?.subject_area as EpisodeInput["subjectArea"]) ?? "",
      gradeLevel: (episode?.grade_level as EpisodeInput["gradeLevel"]) ?? "",
      syllabusTopic: episode?.syllabus_topic ?? "",
      sourceMaterialId: episode?.source_material_id ?? "",
      audioUrl: episode?.audio_url ?? "",
      durationSeconds: episode?.duration_seconds ?? undefined,
    },
  });

  const accessTier = watch("accessTier");
  const sourceMaterialId = watch("sourceMaterialId");
  const selectedSourceMaterial = sourceMaterialOptions.find((sm) => sm.id === sourceMaterialId);

  const handleAudioUpload = async (file: File) => {
    setUploading(true);
    setApiError(undefined);

    // Read duration client-side via a temporary <audio> element before
    // uploading — no server-side audio-processing library needed.
    const duration = await new Promise<number>((resolve, reject) => {
      const audio = new Audio();
      audio.preload = "metadata";
      audio.onloadedmetadata = () => resolve(Math.round(audio.duration));
      audio.onerror = () => reject(new Error("Could not read audio file metadata."));
      audio.src = URL.createObjectURL(file);
    }).catch((err: Error) => {
      setApiError(err.message);
      return null;
    });

    if (duration === null) {
      setUploading(false);
      return;
    }

    const supabase = createClient();
    const path = `episodes/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("audio-episodes").upload(path, file);
    if (uploadError) {
      setApiError(uploadError.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("audio-episodes").getPublicUrl(path);
    setValue("audioUrl", data.publicUrl);
    setValue("durationSeconds", duration);
    setUploading(false);
  };

  const onSubmit = async (values: EpisodeInput) => {
    setApiError(undefined);
    const result = episode
      ? await updateEpisode(episode.id, values, links)
      : await createEpisode(values, links);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.push("/episodes");
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-3">
      <label className="flex flex-col gap-1">
        Series
        <Select {...register("seriesId")}>
          <option value="">Select a series</option>
          {seriesOptions.map((series) => (
            <option key={series.id} value={series.id}>
              {series.title}
            </option>
          ))}
        </Select>
        {errors.seriesId && <p className="text-sm text-red-600">{errors.seriesId.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Episode Number
        <TextInput type="number" {...register("episodeNumber")} />
        {errors.episodeNumber && (
          <p className="text-sm text-red-600">{errors.episodeNumber.message}</p>
        )}
      </label>

      <label className="flex flex-col gap-1">
        Title
        <TextInput {...register("title")} />
        {errors.title && <p className="text-sm text-red-600">{errors.title.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Description
        <Textarea {...register("description")} rows={3} />
      </label>

      <label className="flex flex-col gap-1">
        Language
        <Select {...register("language")}>
          <option value="en">English</option>
          <option value="lg">Luganda</option>
          <option value="sw">Swahili</option>
          <option value="fr">French</option>
          <option value="rw">Kinyarwanda</option>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Access Tier
        <Select {...register("accessTier")}>
          <option value="free">Free</option>
          <option value="coins">Coins</option>
          <option value="premium">Premium</option>
        </Select>
      </label>

      {accessTier === "coins" && (
        <label className="flex flex-col gap-1">
          Coin Price
          <TextInput type="number" {...register("coinPrice")} />
        </label>
      )}

      <label className="flex flex-col gap-1">
        Content Source
        <Select {...register("contentSource")}>
          <option value="narrated_production">Narrated Production</option>
          <option value="elder_testimony">Elder Testimony</option>
          <option value="ai_assisted">AI Assisted</option>
          <option value="tour_guide_original">Tour Guide Original</option>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Subject Area
        <Select {...register("subjectArea")}>
          <option value="">None</option>
          <option value="history">History</option>
          <option value="biology">Biology</option>
          <option value="geography">Geography</option>
          <option value="culture">Culture</option>
          <option value="conservation">Conservation</option>
          <option value="folklore">Folklore</option>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Grade Level
        <Select {...register("gradeLevel")}>
          <option value="">None</option>
          <option value="primary">Primary</option>
          <option value="o_level">O-Level</option>
          <option value="a_level">A-Level</option>
          <option value="tertiary">Tertiary</option>
          <option value="general">General</option>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        Syllabus Topic
        <TextInput {...register("syllabusTopic")} />
      </label>

      <label className="flex flex-col gap-1">
        Source Material
        <Select {...register("sourceMaterialId")}>
          <option value="">None</option>
          {sourceMaterialOptions.map((sm) => (
            <option key={sm.id} value={sm.id}>
              {sm.title}
            </option>
          ))}
        </Select>
        {selectedSourceMaterial && !selectedSourceMaterial.public_domain_verified && (
          <p className="text-sm text-amber-700">This source material is not yet verified.</p>
        )}
      </label>

      <label className="flex flex-col gap-1">
        Audio File
        <input
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleAudioUpload(file);
            }
          }}
        />
        {uploading && <p className="text-sm text-gray-500">Uploading…</p>}
      </label>

      <ContributorLinker options={contributorOptions} links={links} onChange={setLinks} />

      {apiError && <p className="text-sm text-red-600">{apiError}</p>}

      <Button type="submit" disabled={isSubmitting || uploading}>
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/episodes/episode-form.tsx"
git commit -m "Prompt 14: add EpisodeForm with audio upload and duration detection"
```

---

### Task 16: `PublishGuardPanel`

**Files:**

- Create: `apps/admin/src/app/(dashboard)/episodes/publish-guard-panel.tsx`

**Interfaces:**

- Consumes: `PublishCheck` (Task 12), `validateEpisodeForPublish`/`publishEpisode`/`unpublishEpisode` (Task 13), `Button` (Task 4).
- Produces: `PublishGuardPanel({ episodeId, status }: { episodeId: string; status: string })`. Consumed by Task 17's edit page.

- [ ] **Step 1: Write `PublishGuardPanel`**

```tsx
// apps/admin/src/app/(dashboard)/episodes/publish-guard-panel.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/button";

import type { PublishCheck } from "./check-publish-requirements";
import { publishEpisode, unpublishEpisode, validateEpisodeForPublish } from "./publish-actions";

export function PublishGuardPanel({ episodeId, status }: { episodeId: string; status: string }) {
  const router = useRouter();
  const [checks, setChecks] = useState<PublishCheck[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  const handleCheck = async () => {
    setIsChecking(true);
    setApiError(undefined);
    const result = await validateEpisodeForPublish(episodeId);
    setChecks(result);
    setIsChecking(false);
  };

  const handleConfirmPublish = async () => {
    setIsPublishing(true);
    setApiError(undefined);
    const result = await publishEpisode(episodeId);
    setIsPublishing(false);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
    setChecks(null);
  };

  const handleUnpublish = async () => {
    setApiError(undefined);
    const result = await unpublishEpisode(episodeId);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
  };

  if (status === "published") {
    return (
      <div className="flex flex-col gap-2 rounded border border-gray-200 p-4">
        <p className="font-medium">This episode is published.</p>
        <Button variant="secondary" onClick={() => void handleUnpublish()}>
          Unpublish
        </Button>
        {apiError && <p className="text-sm text-red-600">{apiError}</p>}
      </div>
    );
  }

  const allPassed = checks !== null && checks.every((check) => check.passed);

  return (
    <div className="flex flex-col gap-3 rounded border border-gray-200 p-4">
      <Button variant="secondary" onClick={() => void handleCheck()} disabled={isChecking}>
        {isChecking ? "Checking…" : "Check Publish Requirements"}
      </Button>

      {checks && (
        <ul className="flex flex-col gap-1">
          {checks.map((check) => (
            <li key={check.label} className={check.passed ? "text-green-700" : "text-red-700"}>
              {check.passed ? "✓" : "✗"} {check.label}
              {!check.passed && check.reason && (
                <span className="block text-sm text-gray-600">{check.reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      {allPassed && (
        <Button onClick={() => void handleConfirmPublish()} disabled={isPublishing}>
          {isPublishing ? "Publishing…" : "Confirm Publish"}
        </Button>
      )}

      {apiError && <p className="text-sm text-red-600">{apiError}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/episodes/publish-guard-panel.tsx"
git commit -m "Prompt 14: add PublishGuardPanel"
```

---

### Task 17: Episode list, new, and edit pages

**Files:**

- Create: `apps/admin/src/app/(dashboard)/episodes/episode-table.tsx`
- Create: `apps/admin/src/app/(dashboard)/episodes/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/episodes/new/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/episodes/[id]/edit/page.tsx`

**Interfaces:**

- Consumes: `DataTable` (Task 5), `ContributorOption` (Task 14), `EpisodeForm`/`EpisodeRow`/`SeriesOption`/`SourceMaterialOption` (Task 15), `PublishGuardPanel` (Task 16), `deleteEpisode` (Task 11).

- [ ] **Step 1: Write `EpisodeTable`**

```tsx
// apps/admin/src/app/(dashboard)/episodes/episode-table.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable } from "@/components/data-table";

import { deleteEpisode } from "./actions";

export type EpisodeListRow = {
  id: string;
  title: string;
  status: string;
  series: { title: string } | null;
};

export function EpisodeTable({ episodes }: { episodes: EpisodeListRow[] }) {
  const router = useRouter();

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this episode? This cannot be undone.")) {
      return;
    }
    await deleteEpisode(id);
    router.refresh();
  };

  return (
    <DataTable
      rows={episodes}
      getRowKey={(row) => row.id}
      searchPlaceholder="Search by title, series, or status…"
      filterRow={(row, query) =>
        row.title.toLowerCase().includes(query) ||
        (row.series?.title ?? "").toLowerCase().includes(query) ||
        row.status.toLowerCase().includes(query)
      }
      columns={[
        { header: "Title", cell: (row) => row.title },
        { header: "Series", cell: (row) => row.series?.title ?? "—" },
        { header: "Status", cell: (row) => row.status },
        {
          header: "Actions",
          cell: (row) => (
            <div className="flex gap-2">
              <Link
                href={`/episodes/${row.id}/edit`}
                className="text-sm text-blue-700 hover:underline"
              >
                Edit
              </Link>
              <button
                onClick={() => void handleDelete(row.id)}
                className="text-sm text-red-700 hover:underline"
              >
                Delete
              </button>
            </div>
          ),
        },
      ]}
    />
  );
}
```

- [ ] **Step 2: Write the list page**

```tsx
// apps/admin/src/app/(dashboard)/episodes/page.tsx
import Link from "next/link";

import { Button } from "@/components/button";
import { createClient } from "@/lib/supabase/server";

import { EpisodeTable } from "./episode-table";

export default async function EpisodesPage() {
  const supabase = await createClient();
  const { data: episodes, error } = await supabase
    .from("episodes")
    .select("id, title, status, series(title)")
    .order("title", { ascending: true })
    .returns<{ id: string; title: string; status: string; series: { title: string } | null }[]>();

  if (error) {
    return <p className="text-red-600">Failed to load episodes: {error.message}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Episodes</h1>
        <Link href="/episodes/new">
          <Button>New Episode</Button>
        </Link>
      </div>
      <EpisodeTable episodes={episodes} />
    </div>
  );
}
```

- [ ] **Step 3: Write a shared option-fetching helper**

Both the new and edit pages need the same three option lists (series, source materials, contributors). Rather than duplicating the three queries, add a small helper:

```ts
// apps/admin/src/app/(dashboard)/episodes/load-episode-form-options.ts
import { createClient } from "@/lib/supabase/server";

export async function loadEpisodeFormOptions() {
  const supabase = await createClient();
  const [seriesResult, sourceMaterialsResult, contributorsResult] = await Promise.all([
    supabase.from("series").select("id, title").order("title"),
    supabase.from("source_materials").select("id, title, public_domain_verified").order("title"),
    supabase
      .from("contributors")
      .select("id, display_name, contributor_type")
      .order("display_name"),
  ]);

  return {
    seriesOptions: seriesResult.data ?? [],
    sourceMaterialOptions: sourceMaterialsResult.data ?? [],
    contributorOptions: contributorsResult.data ?? [],
  };
}
```

- [ ] **Step 4: Write the new page**

```tsx
// apps/admin/src/app/(dashboard)/episodes/new/page.tsx
import { EpisodeForm } from "../episode-form";
import { loadEpisodeFormOptions } from "../load-episode-form-options";

export default async function NewEpisodePage() {
  const { seriesOptions, sourceMaterialOptions, contributorOptions } =
    await loadEpisodeFormOptions();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New Episode</h1>
      <EpisodeForm
        seriesOptions={seriesOptions}
        sourceMaterialOptions={sourceMaterialOptions}
        contributorOptions={contributorOptions}
        existingLinks={[]}
      />
    </div>
  );
}
```

- [ ] **Step 5: Write the edit page**

```tsx
// apps/admin/src/app/(dashboard)/episodes/[id]/edit/page.tsx
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { EpisodeForm } from "../../episode-form";
import { loadEpisodeFormOptions } from "../../load-episode-form-options";
import { PublishGuardPanel } from "../../publish-guard-panel";

export default async function EditEpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [episodeResult, options, linksResult] = await Promise.all([
    supabase
      .from("episodes")
      .select(
        "id, series_id, episode_number, title, description, language, access_tier, coin_price, content_source, subject_area, grade_level, syllabus_topic, source_material_id, audio_url, duration_seconds, status",
      )
      .eq("id", id)
      .single(),
    loadEpisodeFormOptions(),
    supabase.from("episode_contributors").select("contributor_id, role").eq("episode_id", id),
  ]);

  if (episodeResult.error || !episodeResult.data) {
    notFound();
  }

  const existingLinks = (linksResult.data ?? []).map((link) => ({
    contributorId: link.contributor_id,
    role: link.role,
  }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Edit Episode</h1>
      <EpisodeForm
        episode={episodeResult.data}
        seriesOptions={options.seriesOptions}
        sourceMaterialOptions={options.sourceMaterialOptions}
        contributorOptions={options.contributorOptions}
        existingLinks={existingLinks}
      />
      <PublishGuardPanel episodeId={episodeResult.data.id} status={episodeResult.data.status} />
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 7: Manually verify** — create an episode with `content_source = elder_testimony` and no linked contributors, confirm "Check Publish Requirements" blocks publishing with a clear reason and no "Confirm Publish" button appears; link an elder contributor, confirm it's still blocked (no consent yet); manually insert a `consents` row with `consent_type = 'story_recording'`, `consent_status = 'granted'` for that contributor via the Supabase SQL editor, re-check, confirm it now passes and publishing succeeds; confirm `admin_actions` recorded the publish.

- [ ] **Step 8: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/episodes/episode-table.tsx" "apps/admin/src/app/(dashboard)/episodes/page.tsx" "apps/admin/src/app/(dashboard)/episodes/load-episode-form-options.ts" "apps/admin/src/app/(dashboard)/episodes/new" "apps/admin/src/app/(dashboard)/episodes/[id]"
git commit -m "Prompt 14: add episode list, new, and edit pages"
```

---

### Task 18: Destination validation schema + Server Actions

**Files:**

- Modify: `apps/admin/src/lib/validation.ts`
- Create: `apps/admin/src/app/(dashboard)/destinations/actions.ts`
- Create: `apps/admin/src/app/(dashboard)/destinations/media-actions.ts`

**Interfaces:**

- Consumes: `requireAdmin`, `logAdminAction` (Task 3).
- Produces: `destinationSchema`, `DestinationInput` type; `createDestination(input: DestinationInput): Promise<ActionResult & { id?: string }>`, `updateDestination(id: string, input: DestinationInput): Promise<ActionResult>`, `deleteDestination(id: string): Promise<ActionResult>`, `toggleDestinationPublish(id: string, isPublished: boolean): Promise<ActionResult>`; `addDestinationMedia(destinationId: string, mediaUrl: string, caption: string | undefined, sortOrder: number): Promise<ActionResult>`, `reorderDestinationMedia(updates: { id: string; sortOrder: number }[]): Promise<ActionResult>`, `deleteDestinationMedia(id: string, destinationId: string): Promise<ActionResult>`. Consumed by Task 20 (`DestinationForm`), Task 21 (`MediaGallery`), Task 22 (list page).

- [ ] **Step 1: Add the destination schema**

Append to `apps/admin/src/lib/validation.ts`:

```ts
export const destinationSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  slug: z.string().trim().min(1, "Slug is required"),
  description: z.string().trim().optional(),
  region: z.string().trim().optional(),
  district: z.string().trim().optional(),
  country: z.string().trim().optional(),
  bestTimeToVisit: z.string().trim().optional(),
  entryFeeNotes: z.string().trim().optional(),
  safetyNotes: z.string().trim().optional(),
  conservationNotes: z.string().trim().optional(),
  coverImageUrl: z.string().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  isPublished: z.boolean(),
});
export type DestinationInput = z.infer<typeof destinationSchema>;
```

- [ ] **Step 2: Write the core Destination Server Actions**

```ts
// apps/admin/src/app/(dashboard)/destinations/actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import type { DestinationInput } from "@/lib/validation";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

function toRow(input: DestinationInput) {
  return {
    name: input.name,
    slug: input.slug,
    description: input.description || null,
    region: input.region || null,
    district: input.district || null,
    country: input.country || null,
    best_time_to_visit: input.bestTimeToVisit || null,
    entry_fee_notes: input.entryFeeNotes || null,
    safety_notes: input.safetyNotes || null,
    conservation_notes: input.conservationNotes || null,
    cover_image_url: input.coverImageUrl || null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    is_published: input.isPublished,
  };
}

export async function createDestination(
  input: DestinationInput,
): Promise<ActionResult & { id?: string }> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("destinations")
    .insert(toRow(input))
    .select("id")
    .single();
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "create", "destination", data.id, { name: input.name });
  revalidatePath("/destinations");
  return { ok: true, id: data.id };
}

export async function updateDestination(
  id: string,
  input: DestinationInput,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("destinations").update(toRow(input)).eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "update", "destination", id, { name: input.name });
  revalidatePath("/destinations");
  return { ok: true };
}

export async function deleteDestination(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("destinations").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "delete", "destination", id);
  revalidatePath("/destinations");
  return { ok: true };
}

export async function toggleDestinationPublish(
  id: string,
  isPublished: boolean,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("destinations")
    .update({ is_published: isPublished })
    .eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, isPublished ? "publish" : "unpublish", "destination", id);
  revalidatePath("/destinations");
  return { ok: true };
}
```

- [ ] **Step 3: Write the media Server Actions**

```ts
// apps/admin/src/app/(dashboard)/destinations/media-actions.ts
"use server";

import { revalidatePath } from "next/cache";

import { logAdminAction } from "@/lib/log-admin-action";
import { requireAdmin } from "@/lib/require-admin";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export type ActionResult = { ok: true } | { ok: false; message: string };

export async function addDestinationMedia(
  destinationId: string,
  mediaUrl: string,
  caption: string | undefined,
  sortOrder: number,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("destination_media").insert({
    destination_id: destinationId,
    media_url: mediaUrl,
    media_type: "image",
    caption: caption || null,
    sort_order: sortOrder,
  });
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "update", "destination", destinationId, {
    action: "add_media",
  });
  revalidatePath(`/destinations/${destinationId}/edit`);
  return { ok: true };
}

export async function reorderDestinationMedia(
  updates: { id: string; sortOrder: number }[],
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  for (const update of updates) {
    const { error } = await supabase
      .from("destination_media")
      .update({ sort_order: update.sortOrder })
      .eq("id", update.id);
    if (error) {
      return { ok: false, message: error.message };
    }
  }

  return { ok: true };
}

export async function deleteDestinationMedia(
  id: string,
  destinationId: string,
): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return admin;
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("destination_media").delete().eq("id", id);
  if (error) {
    return { ok: false, message: error.message };
  }

  await logAdminAction(admin.adminId, "update", "destination", destinationId, {
    action: "delete_media",
  });
  revalidatePath(`/destinations/${destinationId}/edit`);
  return { ok: true };
}
```

`reorderDestinationMedia` doesn't log to `admin_actions` — it's a pure ordering change with no meaningful content to audit (unlike add/delete, which change what media exists at all); the spec doesn't call out reordering as one of the "create/update/publish/delete" actions that need logging, and a per-drag audit entry would be noise.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/lib/validation.ts "apps/admin/src/app/(dashboard)/destinations/actions.ts" "apps/admin/src/app/(dashboard)/destinations/media-actions.ts"
git commit -m "Prompt 14: add destination validation schema and server actions"
```

---

### Task 19: Install Leaflet + `MapPicker`

**Files:**

- Modify: `apps/admin/package.json` (add `leaflet`, `react-leaflet`, `@types/leaflet`)
- Create: `apps/admin/src/app/(dashboard)/destinations/map-picker.tsx`
- Create: `apps/admin/src/app/(dashboard)/destinations/map-picker-inner.tsx`

**Interfaces:**

- Produces: `MapPicker({ latitude, longitude, onChange }: MapPickerProps)`. Consumed by Task 20 (`DestinationForm`).

Leaflet touches `window` at import time, so the actual map component (`MapPickerInner`) must never render during SSR. `MapPicker` is the public export — a thin wrapper that `next/dynamic`-imports `MapPickerInner` with `ssr: false`. Splitting these into two files (rather than one file calling `dynamic(() => import("./self"))`) avoids a self-referential dynamic import.

- [ ] **Step 1: Install the dependencies**

```bash
cd apps/admin && pnpm add leaflet react-leaflet && pnpm add -D @types/leaflet
```

- [ ] **Step 2: Write `MapPickerInner`**

```tsx
// apps/admin/src/app/(dashboard)/destinations/map-picker-inner.tsx
"use client";

import "leaflet/dist/leaflet.css";

import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";

// Leaflet's default marker icon references image URLs that don't resolve
// correctly under a bundler without this — a well-known Leaflet/webpack
// interop issue, not specific to this codebase.
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Kampala, Uganda — a reasonable default center given the app's stated
// geographic focus, used only when a destination has no coordinates yet.
const DEFAULT_CENTER: [number, number] = [0.3476, 32.5825];

function ClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function MapPickerInner({
  latitude,
  longitude,
  onChange,
}: {
  latitude?: number;
  longitude?: number;
  onChange: (lat: number, lng: number) => void;
}) {
  const center: [number, number] =
    latitude !== undefined && longitude !== undefined ? [latitude, longitude] : DEFAULT_CENTER;

  return (
    <MapContainer center={center} zoom={latitude !== undefined ? 10 : 6} style={{ height: 300 }}>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onPick={onChange} />
      {latitude !== undefined && longitude !== undefined && (
        <Marker position={[latitude, longitude]} icon={markerIcon} />
      )}
    </MapContainer>
  );
}
```

- [ ] **Step 3: Write `MapPicker`**

```tsx
// apps/admin/src/app/(dashboard)/destinations/map-picker.tsx
"use client";

import dynamic from "next/dynamic";

const MapPickerInner = dynamic(() => import("./map-picker-inner"), { ssr: false });

export function MapPicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude?: number;
  longitude?: number;
  onChange: (lat: number, lng: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <MapPickerInner latitude={latitude} longitude={longitude} onChange={onChange} />
      <p className="text-sm text-gray-500">
        {latitude !== undefined && longitude !== undefined
          ? `Selected: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
          : "Click the map to set this destination's location."}
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/package.json pnpm-lock.yaml "apps/admin/src/app/(dashboard)/destinations/map-picker.tsx" "apps/admin/src/app/(dashboard)/destinations/map-picker-inner.tsx"
git commit -m "Prompt 14: add Leaflet map picker for destinations"
```

---

### Task 20: `DestinationForm`

**Files:**

- Create: `apps/admin/src/app/(dashboard)/destinations/destination-form.tsx`

**Interfaces:**

- Consumes: `destinationSchema`/`DestinationInput` (Task 18), `createDestination`/`updateDestination` (Task 18), `slugify` (Task 2), `MapPicker` (Task 19), `Button`/`TextInput`/`Textarea`/`Toggle` (Task 4).
- Produces: `DestinationForm({ destination }: { destination?: DestinationRow })`. Consumed by Task 22's new/edit pages.

- [ ] **Step 1: Write `DestinationForm`**

```tsx
// apps/admin/src/app/(dashboard)/destinations/destination-form.tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/button";
import { Textarea } from "@/components/textarea";
import { TextInput } from "@/components/text-input";
import { Toggle } from "@/components/toggle";
import { createClient } from "@/lib/supabase/client";
import { slugify } from "@/lib/slugify";
import { type DestinationInput, destinationSchema } from "@/lib/validation";

import { createDestination, updateDestination } from "./actions";
import { MapPicker } from "./map-picker";

export type DestinationRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  region: string | null;
  district: string | null;
  country: string | null;
  best_time_to_visit: string | null;
  entry_fee_notes: string | null;
  safety_notes: string | null;
  conservation_notes: string | null;
  cover_image_url: string | null;
  latitude: number | null;
  longitude: number | null;
  is_published: boolean;
};

export function DestinationForm({ destination }: { destination?: DestinationRow }) {
  const router = useRouter();
  const [apiError, setApiError] = useState<string | undefined>();
  const [uploading, setUploading] = useState(false);
  const slugTouchedRef = useRef(destination ? true : false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DestinationInput>({
    resolver: zodResolver(destinationSchema),
    defaultValues: {
      name: destination?.name ?? "",
      slug: destination?.slug ?? "",
      description: destination?.description ?? "",
      region: destination?.region ?? "",
      district: destination?.district ?? "",
      country: destination?.country ?? "",
      bestTimeToVisit: destination?.best_time_to_visit ?? "",
      entryFeeNotes: destination?.entry_fee_notes ?? "",
      safetyNotes: destination?.safety_notes ?? "",
      conservationNotes: destination?.conservation_notes ?? "",
      coverImageUrl: destination?.cover_image_url ?? "",
      latitude: destination?.latitude ?? undefined,
      longitude: destination?.longitude ?? undefined,
      isPublished: destination?.is_published ?? false,
    },
  });

  const name = watch("name");
  const latitude = watch("latitude");
  const longitude = watch("longitude");

  const handleNameChange = (value: string) => {
    setValue("name", value);
    if (!slugTouchedRef.current) {
      setValue("slug", slugify(value));
    }
  };

  const handleSlugChange = (value: string) => {
    slugTouchedRef.current = true;
    setValue("slug", value);
  };

  const handleCoverUpload = async (file: File) => {
    setUploading(true);
    setApiError(undefined);
    const supabase = createClient();
    const path = `destinations/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("images").upload(path, file);
    if (uploadError) {
      setApiError(uploadError.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("images").getPublicUrl(path);
    setValue("coverImageUrl", data.publicUrl);
    setUploading(false);
  };

  const onSubmit = async (values: DestinationInput) => {
    setApiError(undefined);
    const result = destination
      ? await updateDestination(destination.id, values)
      : await createDestination(values);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.push(destination ? "/destinations" : `/destinations/${result.id}/edit`);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex max-w-lg flex-col gap-3">
      <label className="flex flex-col gap-1">
        Name
        <TextInput
          {...register("name")}
          onChange={(e) => handleNameChange(e.target.value)}
          value={name}
        />
        {errors.name && <p className="text-sm text-red-600">{errors.name.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Slug
        <TextInput {...register("slug")} onChange={(e) => handleSlugChange(e.target.value)} />
        {errors.slug && <p className="text-sm text-red-600">{errors.slug.message}</p>}
      </label>

      <label className="flex flex-col gap-1">
        Description
        <Textarea {...register("description")} rows={3} />
      </label>

      <label className="flex flex-col gap-1">
        Region
        <TextInput {...register("region")} />
      </label>

      <label className="flex flex-col gap-1">
        District
        <TextInput {...register("district")} />
      </label>

      <label className="flex flex-col gap-1">
        Country
        <TextInput {...register("country")} />
      </label>

      <label className="flex flex-col gap-1">
        Best Time to Visit
        <Textarea {...register("bestTimeToVisit")} rows={2} />
      </label>

      <label className="flex flex-col gap-1">
        Entry Fee Notes
        <Textarea {...register("entryFeeNotes")} rows={2} />
      </label>

      <label className="flex flex-col gap-1">
        Safety Notes
        <Textarea {...register("safetyNotes")} rows={2} />
      </label>

      <label className="flex flex-col gap-1">
        Conservation Notes
        <Textarea {...register("conservationNotes")} rows={2} />
      </label>

      <label className="flex flex-col gap-1">
        Cover Image
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleCoverUpload(file);
            }
          }}
        />
        {uploading && <p className="text-sm text-gray-500">Uploading…</p>}
      </label>

      <div className="flex flex-col gap-1">
        <span>Location</span>
        <MapPicker
          latitude={latitude}
          longitude={longitude}
          onChange={(lat, lng) => {
            setValue("latitude", lat);
            setValue("longitude", lng);
          }}
        />
      </div>

      <Toggle label="Published" {...register("isPublished")} />

      {apiError && <p className="text-sm text-red-600">{apiError}</p>}

      <Button type="submit" disabled={isSubmitting || uploading}>
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
```

Note: on create, this form navigates to `/destinations/${result.id}/edit` rather than back to the list — a brand-new destination has no media yet, and the media gallery (Task 21) only appears on the edit page, so routing straight to edit lets the admin add photos immediately without an extra click back in.

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/destinations/destination-form.tsx"
git commit -m "Prompt 14: add DestinationForm"
```

---

### Task 21: `MediaGallery`

**Files:**

- Create: `apps/admin/src/app/(dashboard)/destinations/media-gallery.tsx`

**Interfaces:**

- Consumes: `addDestinationMedia`/`reorderDestinationMedia`/`deleteDestinationMedia` (Task 18), `Button`/`TextInput` (Task 4).
- Produces: `MediaGallery({ destinationId, media }: { destinationId: string; media: DestinationMediaRow[] })`. Consumed by Task 22's edit page.

- [ ] **Step 1: Write `MediaGallery`**

```tsx
// apps/admin/src/app/(dashboard)/destinations/media-gallery.tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/button";
import { createClient } from "@/lib/supabase/client";

import {
  addDestinationMedia,
  deleteDestinationMedia,
  reorderDestinationMedia,
} from "./media-actions";

export type DestinationMediaRow = {
  id: string;
  media_url: string;
  caption: string | null;
  sort_order: number;
};

export function MediaGallery({
  destinationId,
  media,
}: {
  destinationId: string;
  media: DestinationMediaRow[];
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [apiError, setApiError] = useState<string | undefined>();

  const sorted = [...media].sort((a, b) => a.sort_order - b.sort_order);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setApiError(undefined);
    const supabase = createClient();
    const path = `destinations/${destinationId}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from("images").upload(path, file);
    if (uploadError) {
      setApiError(uploadError.message);
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("images").getPublicUrl(path);
    const nextSortOrder = sorted.length > 0 ? sorted[sorted.length - 1]!.sort_order + 1 : 0;
    const result = await addDestinationMedia(
      destinationId,
      data.publicUrl,
      undefined,
      nextSortOrder,
    );
    setUploading(false);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= sorted.length) {
      return;
    }
    const current = sorted[index]!;
    const target = sorted[targetIndex]!;
    const result = await reorderDestinationMedia([
      { id: current.id, sortOrder: target.sort_order },
      { id: target.id, sortOrder: current.sort_order },
    ]);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this photo? This cannot be undone.")) {
      return;
    }
    const result = await deleteDestinationMedia(id, destinationId);
    if (!result.ok) {
      setApiError(result.message);
      return;
    }
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-3">
      <span>Photo Gallery</span>
      <ul className="flex flex-col gap-2">
        {sorted.map((item, index) => (
          // eslint-disable-next-line @next/next/no-img-element -- admin-only upload preview, not app content
          <li key={item.id} className="flex items-center gap-3">
            <img src={item.media_url} alt={item.caption ?? ""} className="h-16 w-16 object-cover" />
            <span className="text-sm text-gray-600">{item.caption ?? "—"}</span>
            <div className="ml-auto flex gap-2">
              <button
                onClick={() => void handleMove(index, -1)}
                disabled={index === 0}
                className="text-sm text-blue-700 hover:underline disabled:opacity-30"
              >
                Move Up
              </button>
              <button
                onClick={() => void handleMove(index, 1)}
                disabled={index === sorted.length - 1}
                className="text-sm text-blue-700 hover:underline disabled:opacity-30"
              >
                Move Down
              </button>
              <button
                onClick={() => void handleDelete(item.id)}
                className="text-sm text-red-700 hover:underline"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      <label className="flex flex-col gap-1">
        Add Photo
        <input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              void handleUpload(file);
            }
          }}
        />
      </label>
      {uploading && <p className="text-sm text-gray-500">Uploading…</p>}
      {apiError && <p className="text-sm text-red-600">{apiError}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/destinations/media-gallery.tsx"
git commit -m "Prompt 14: add MediaGallery"
```

---

### Task 22: Destination list, new, and edit pages

**Files:**

- Create: `apps/admin/src/app/(dashboard)/destinations/destination-table.tsx`
- Create: `apps/admin/src/app/(dashboard)/destinations/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/destinations/new/page.tsx`
- Create: `apps/admin/src/app/(dashboard)/destinations/[id]/edit/page.tsx`

**Interfaces:**

- Consumes: `DataTable` (Task 5), `DestinationForm`/`DestinationRow` (Task 20), `MediaGallery`/`DestinationMediaRow` (Task 21), `deleteDestination`/`toggleDestinationPublish` (Task 18).

- [ ] **Step 1: Write `DestinationTable`**

```tsx
// apps/admin/src/app/(dashboard)/destinations/destination-table.tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { DataTable } from "@/components/data-table";

import { deleteDestination, toggleDestinationPublish } from "./actions";
import type { DestinationRow } from "./destination-form";

export function DestinationTable({ destinations }: { destinations: DestinationRow[] }) {
  const router = useRouter();

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this destination? This cannot be undone.")) {
      return;
    }
    await deleteDestination(id);
    router.refresh();
  };

  const handleTogglePublish = async (row: DestinationRow) => {
    await toggleDestinationPublish(row.id, !row.is_published);
    router.refresh();
  };

  return (
    <DataTable
      rows={destinations}
      getRowKey={(row) => row.id}
      searchPlaceholder="Search by name, region, or country…"
      filterRow={(row, query) =>
        row.name.toLowerCase().includes(query) ||
        (row.region ?? "").toLowerCase().includes(query) ||
        (row.country ?? "").toLowerCase().includes(query)
      }
      columns={[
        { header: "Name", cell: (row) => row.name },
        { header: "Region", cell: (row) => row.region ?? "—" },
        { header: "Country", cell: (row) => row.country ?? "—" },
        { header: "Status", cell: (row) => (row.is_published ? "Published" : "Draft") },
        {
          header: "Actions",
          cell: (row) => (
            <div className="flex gap-2">
              <Link
                href={`/destinations/${row.id}/edit`}
                className="text-sm text-blue-700 hover:underline"
              >
                Edit
              </Link>
              <button
                onClick={() => void handleTogglePublish(row)}
                className="text-sm text-blue-700 hover:underline"
              >
                {row.is_published ? "Unpublish" : "Publish"}
              </button>
              <button
                onClick={() => void handleDelete(row.id)}
                className="text-sm text-red-700 hover:underline"
              >
                Delete
              </button>
            </div>
          ),
        },
      ]}
    />
  );
}
```

- [ ] **Step 2: Write the list page**

```tsx
// apps/admin/src/app/(dashboard)/destinations/page.tsx
import Link from "next/link";

import { Button } from "@/components/button";
import { createClient } from "@/lib/supabase/server";

import { DestinationTable } from "./destination-table";

export default async function DestinationsPage() {
  const supabase = await createClient();
  const { data: destinations, error } = await supabase
    .from("destinations")
    .select(
      "id, name, slug, description, region, district, country, best_time_to_visit, entry_fee_notes, safety_notes, conservation_notes, cover_image_url, latitude, longitude, is_published",
    )
    .order("name", { ascending: true });

  if (error) {
    return <p className="text-red-600">Failed to load destinations: {error.message}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Destinations</h1>
        <Link href="/destinations/new">
          <Button>New Destination</Button>
        </Link>
      </div>
      <DestinationTable destinations={destinations} />
    </div>
  );
}
```

- [ ] **Step 3: Write the new page**

```tsx
// apps/admin/src/app/(dashboard)/destinations/new/page.tsx
import { DestinationForm } from "../destination-form";

export default function NewDestinationPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New Destination</h1>
      <DestinationForm />
    </div>
  );
}
```

- [ ] **Step 4: Write the edit page**

```tsx
// apps/admin/src/app/(dashboard)/destinations/[id]/edit/page.tsx
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

import { DestinationForm } from "../../destination-form";
import { MediaGallery } from "../../media-gallery";

export default async function EditDestinationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [destinationResult, mediaResult] = await Promise.all([
    supabase
      .from("destinations")
      .select(
        "id, name, slug, description, region, district, country, best_time_to_visit, entry_fee_notes, safety_notes, conservation_notes, cover_image_url, latitude, longitude, is_published",
      )
      .eq("id", id)
      .single(),
    supabase
      .from("destination_media")
      .select("id, media_url, caption, sort_order")
      .eq("destination_id", id)
      .order("sort_order"),
  ]);

  if (destinationResult.error || !destinationResult.data) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Edit Destination</h1>
      <DestinationForm destination={destinationResult.data} />
      <MediaGallery destinationId={id} media={mediaResult.data ?? []} />
    </div>
  );
}
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck
```

Expected: 0 errors.

- [ ] **Step 6: Manually verify** — run `pnpm --filter admin dev`, create a destination, confirm clicking the map sets the lat/lng fields and shows a marker, save, confirm it redirects to the edit page, upload two photos to the gallery, confirm move-up/move-down actually swaps their order and persists after a refresh, delete one, confirm `admin_actions` recorded create/publish/media events.

- [ ] **Step 7: Commit**

```bash
git add "apps/admin/src/app/(dashboard)/destinations/destination-table.tsx" "apps/admin/src/app/(dashboard)/destinations/page.tsx" "apps/admin/src/app/(dashboard)/destinations/new" "apps/admin/src/app/(dashboard)/destinations/[id]"
git commit -m "Prompt 14: add destination list, new, and edit pages"
```

---

### Task 23: Document deferred video support

**Files:**

- Modify: `docs/known-issues.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Add the known-issues entry**

Append under `## Backend / Database` if that section still ends the file (it was added by the `daily-engagement` branch's final review and may or may not have merged to `main` yet by the time this task runs — check the file first; if that section isn't present yet, add a new `## Admin` top-level section instead, following the same per-entry format as the existing `## Mobile` section: heading, description, `**Fix shape:**`, `**Severity:**`):

```markdown
### Destination media gallery has no video support

The `destination_media` table's `media_type` column supports `'video'`,
but the admin dashboard's media gallery (Prompt 14) only implements
image upload — video upload/preview is meaningfully more UI work than
images (no free inline `<img>`-style preview), and the prompt's own text
only said "media gallery upload" without calling out video specifically.

**Fix shape:** add a video file-type branch to `MediaGallery`'s upload
handler (`apps/admin/src/app/(dashboard)/destinations/media-gallery.tsx`)
and render an inline `<video>` preview instead of `<img>` when
`media_type = 'video'`.

**Severity:** Low. No destination currently needs video, and adding it
later is additive — no schema or existing-row migration needed.
```

- [ ] **Step 2: Commit**

```bash
git add docs/known-issues.md
git commit -m "Prompt 14: document deferred video support in destination media gallery"
```

---
