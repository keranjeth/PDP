# Training Records validation

Implemented against main at ae4fb506e46a87eec73035cbcd018d5e10d14eda.

## Checks completed

- Clean Next.js production build and TypeScript: passed.
- ESLint on changed TypeScript/TSX and test files: passed.
- Seventeen automated dashboard, import, validation, export, API retry, and stale-edit tests: passed.
- Live Supabase transaction tests: create, edit without double deduction, repeat participation on different dates, duplicate protection, funding splits, currency and date checks, budget adjustment/transfer safeguards, atomic import rollback, import retry, soft deletion, and anonymous read denial: passed.
- Live regional-role tests: reads limited to assigned region; another region's training cannot be created; deletion blocked without Head of HR/Super Admin permission: passed.
- All database test rows, document counter increments, and temporary role assignments rolled back. Source data remains 847 employees and 803 budgets; no test training records remain.
- Training table and both list views use existing employee/organization/region access. Both views use security_invoker=true.

Run the automated tests with:

```sh
node --test tests/dashboard.test.mjs tests/training.test.mjs
```

The live tests are in tests/training-records.sql. They require an active Super Admin and representative employee/budget data; every transaction ends with ROLLBACK.

## UI inspection and limits

The employee-page screenshot supplied in the conversation was used as the reference. An isolated browser fixture rendered the four metric cards, tabs, rounded records panel, compact search, outlined green Import/Export/New actions, red Delete action, table headings, avatar, rows, and pagination. Existing application components and tokens were reused.

Browser interaction verification was incomplete: the preview runtime did not reliably hydrate and subsequently failed to load. Save/edit/import/delete behavior was instead checked through API/unit tests and live database transactions. No claim of a complete browser interaction pass is made. Temporary fixtures and preview startup changes are excluded from the commit.

## Existing Supabase advisories

The project advisor also reports pre-existing anonymous-executable SECURITY DEFINER budget helpers, mutable search paths on employee functions, and disabled leaked-password protection. Those unrelated settings are not changed here. The new training import RPC uses SECURITY INVOKER; its trigger is private, not an exposed callable API.

- [Function execution grants](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
- [Function search paths](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable)
- [Password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
