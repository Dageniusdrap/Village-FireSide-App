# Test accounts

Three shared accounts exist for manually exercising each role, one per
`user_role` that has its own screens. They live in the linked Supabase
project (`dulratrptkkswvbbrffc`), not in a local database.

| Email                              | Role       | Use it for                                                                                 |
| ---------------------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| `admin-test@villagefireside.app`   | `admin`    | The admin dashboard (`apps/admin`): series, episodes, destinations, teacher-request review |
| `teacher-test@villagefireside.app` | `teacher`  | Mobile Learn tab as a teacher: creating classes, assigning episodes, the class quiz view   |
| `test@villagefireside.app`         | `listener` | Mobile app as an ordinary listener: playback, unlocks, streaks, quizzes, joining a class   |

The `guide` role has no screens yet, so it has no account. Add one here and
in the provisioning script when it does.

## Passwords

**Passwords are not in this repo, on purpose.** The repo is public, and the
admin account has full read/write access to every table through
`is_admin()`. Committing its password would hand that access to anyone.

Each developer keeps the passwords in `apps/admin/.env.local` (gitignored)
as `TEST_ADMIN_PASSWORD`, `TEST_TEACHER_PASSWORD` and
`TEST_LISTENER_PASSWORD`. Get the current values from the project owner,
or set your own with `--reset-passwords` (below), which changes them for
everyone.

## Creating or repairing the accounts

```sh
cd apps/admin
pnpm provision:test-accounts
```

`apps/admin/scripts/provision-test-accounts.mjs` uses the service-role key
from `apps/admin/.env.local`. For each account it:

- creates the user with its `TEST_*_PASSWORD` if it doesn't exist, already
  email-confirmed;
- otherwise leaves the password alone and just marks the email confirmed;
- sets `profiles.role`. Every new profile starts as `listener` via
  `handle_new_user()`, and only the service role may change `role`
  (`profiles_protect_columns` trigger), which is why this needs the script
  or the SQL editor rather than the app.

It is safe to re-run; it only brings the three accounts back to the state
in the table above. Pass `--reset-passwords` to also overwrite existing
accounts' passwords with the values in `.env.local`, then tell the rest of
the team the new values.

## Signing in

- **Admin dashboard:** `pnpm --filter admin dev`, then sign in at
  `/sign-in` as `admin-test@villagefireside.app`. Any other role is sent to
  `/not-authorized`.
- **Mobile app:** sign in with email and password as the teacher or
  listener account.

For setting up a real (non-test) admin, see "Creating the first admin
user" in [auth.md](auth.md).
