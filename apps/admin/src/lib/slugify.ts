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
