# Dedicated test accounts for login flows

## Deployment

Apply `backend/supabase/migrations/0027_test_credentials.sql` to the Supabase project before using this feature. Deploy the updated frontend and worker together. No application encryption key or new environment secret is required: the migration uses the project's Supabase Vault extension. The live migration is not applied by building the frontend or running the local tests.

Vault stores the encrypted username/password JSON; `test_steps.value` stores only `{{test.username}}` and `{{test.password}}`. See [Supabase Vault](https://supabase.com/docs/guides/database/vault). Vault administrators and trusted service-role code retain privileged access; this is not encryption against the project operator.

## Configure and verify

1. Open a customer flow for an HTTPS site. Select **Use login template** if starting from scratch; it replaces the editor's current steps.
2. Under **Dedicated test account**, provide a website test username and password. These are not the user's FlowGuardian credentials. Existing values are not returned to the browser; blank fields preserve the saved account.
3. Adjust `/login`, the field labels, the Login button, the protected destination and the authenticated heading to match the site.
4. Use **Test username** and **Test password** as value sources in the two fill steps. Do not paste the password as ordinary step text.
5. Review and authorize the interactions, then **Save and verify**. Each attempt starts with a new browser context, without cookies or a reused authenticated session.
6. Inspect the recorded outcomes. After a successful fresh verification, explicitly enable monitoring at the chosen interval.

The worker resolves account references only for fill steps, requires HTTPS and restricts navigation to the configured origin. External SSO is not supported by this first implementation. Flow assertions must identify a meaningful authenticated state. Strict flow URL assertions compare the origin and pathname, so `/login?next=/account` does not count as reaching `/account`.

## Storage and lifecycle

- Owner-only functions expose account presence and replacement/removal; they do not return stored values. Anonymous users cannot execute them. Authenticated users cannot select the credential mapping, decrypt Vault data, or call the worker read function.
- Only the worker's service role may call `worker_test_credentials`. Credentials are bound to the site's stored URL; changing it makes the previous credentials unavailable until replaced.
- Replacing or removing the account pauses the flow and updates the revision timestamp so older runs cannot verify the changed configuration. Queued/running tests reject account changes.
- Deleting the flow cascades to the credential mapping and removes the associated Vault secret.

## Evidence and limits

Credential-bearing runs retain only step action, position, status and duration with redacted input and target information. Raw console/network diagnostics, titles and screenshots are not stored, even if the target site prints a password or puts it in an error. Failure messages are generic. Non-credential runs retain their existing evidence behavior.

This adds protected test-account use for owner-configured login flows. It does not automate CAPTCHA, two-factor authentication, email verification, external identity providers or account cleanup. Repeated registration needs a separate unique-data and cleanup strategy. A successful on-page assertion proves only the configured condition, not delivery or business fulfillment. Use a dedicated account with limited permissions.

## Validation

`npm run test:accounts --prefix backend/worker` runs:

- Real Chromium login against a controlled local form, including server authentication, session cookie, authenticated destination, fresh sessions across runs, and suppression of raw credential artifacts on failure.
- Postgres execution of the actual migration's functions, grants, ownership checks, rotation and deletion triggers using PGlite. The test stubs the Vault API; it does **not** exercise the Supabase encryption engine or prove the live project is migrated.

The HTTP allowance is an explicit test-only execution option restricted to loopback; the production worker does not enable it. The benchmark workflow runs account tests when the worker or migrations change.
