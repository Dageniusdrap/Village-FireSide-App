// Creates (or repairs) the shared test accounts documented in
// docs/test-accounts.md. Safe to re-run: existing accounts are left with
// their current password unless --reset-passwords is passed, and only their
// role and email confirmation are brought back in line.
//
// Run from apps/admin:  pnpm provision:test-accounts [--reset-passwords]
//
// Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and the
// TEST_*_PASSWORD values from apps/admin/.env.local (gitignored). Passwords
// never live in the repo: it is public, and these accounts sit on a
// reachable Supabase project.
import { createClient } from "@supabase/supabase-js";

const ACCOUNTS = [
  { email: "admin-test@villagefireside.app", role: "admin", passwordVar: "TEST_ADMIN_PASSWORD" },
  {
    email: "teacher-test@villagefireside.app",
    role: "teacher",
    passwordVar: "TEST_TEACHER_PASSWORD",
  },
  { email: "test@villagefireside.app", role: "listener", passwordVar: "TEST_LISTENER_PASSWORD" },
];

const resetPasswords = process.argv.includes("--reset-passwords");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. Add it to apps/admin/.env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

const supabase = createClient(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function findUserByEmail(email) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < 1000) return null;
  }
}

for (const account of ACCOUNTS) {
  let user = await findUserByEmail(account.email);
  let action;

  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: account.email,
      password: requireEnv(account.passwordVar),
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
    action = "created";
  } else {
    const attributes = { email_confirm: true };
    if (resetPasswords) attributes.password = requireEnv(account.passwordVar);
    const { error } = await supabase.auth.admin.updateUserById(user.id, attributes);
    if (error) throw error;
    action = resetPasswords ? "exists, password reset" : "exists, password unchanged";
  }

  // handle_new_user() creates every profile as 'listener'; the role column is
  // writable only by the service role (profiles_protect_columns trigger).
  const { error: roleError } = await supabase
    .from("profiles")
    .update({ role: account.role })
    .eq("id", user.id);
  if (roleError) throw roleError;

  console.log(`${account.email}: ${action}, role=${account.role}`);
}
