# Customer Flows: first version

Adding a site now performs passive home-page discovery. No complete audit, crawl, essential-test creation or slow-network measurements are started by discovery. The free report and account default tab show possible journeys. The existing audit is retained in Website audit and runs only after the owner requests it. Existing configured tests and their schedules are preserved.

## Discovery

Same-origin links and form structure suggest navigation, product, access, contact and search journeys. Suggestions are explicitly possible, not configured or verified. Only the home page is inspected; absence of a suggestion is not proof of absence. Dynamic menus, cookie walls and login-only features can hide journeys. Discovery can click an explicitly detected sign-in or app-entry button in a fresh browser to inspect the resulting screen. It does not submit forms, enter credentials or enable monitoring. Entry probes block mutating HTTP requests and WebSockets and report inconclusive results instead of assuming a transition.

## Configure, verify, activate

The owner supplies exact targets, input values and a final on-page assertion. An interaction and final assertion are mandatory; a root-only URL assertion is rejected. The editor lists all steps and requires authorization before saving. New flows are created paused with scheduling disabled before steps are inserted. Failed step inserts trigger cleanup. Verification queues a manual run, subject to site ownership verification. The latest visible run must have passed before the UI offers activation, and activation requires explicit confirmation. Only on-page outcomes are supported; inbox delivery, fulfillment and payment success are not inferred.

Flows reuse existing tests/test_steps/runs, marked by the reserved `[Flow] ` name prefix, and are excluded from the ordinary Tests tab. This avoids a database migration for this first version. This is a storage convention, not a security boundary. RLS and existing plan/ownership rules still apply. Saved flows can be edited. Saving first pauses monitoring, refuses to replace steps while a run is pending, and uses the existing transactional save_test RPC to replace the configuration. The first step note records a revision timestamp and short goal. Runs created before that revision cannot verify the edited flow; history is retained. A successful fresh verification and explicit activation are required again. Runs retains shared screenshots and diagnostics. Flow status only consults the loaded run window; an older verification outside that window requires a fresh verification.

## Replay

The public check now includes at most one native browser form-validation probe, preferring an observed account form among the suggestions, otherwise a contact form. It clears editable required fields, tests a malformed email where available, and calls browser validity reporting without clicking submit. During interaction, outbound HTTP requests are aborted, service workers are blocked and WebSockets are closed. It records native required/type-mismatch outcomes without input values. Forms with `novalidate`, missing suitable controls or unobservable validation return `validation_inconclusive`; this is not a confirmed site defect. The probe does not exercise server-side validation, successful authentication, account creation, CAPTCHA, email delivery or custom validation flows. Those require an owner-configured flow and suitable test data. Older reports need a new public check for this evidence.

Free discovery returns up to three distinct suggestions. It inspects visible links and controls on the starting page and a bounded sample of relevant same-origin destinations. Observed product controls, contact forms, search inputs and account inputs take priority over URL-keyword matches. Generic navigation excludes contact pages. Duplicate target pages and semantic types are removed; different observed interactions on the same page can remain distinct. Fewer real suggestions means fewer cards, rather than invented journeys.

Each suggestion includes its own proposed steps and expected result. Public evidence records direct navigation and read-only control inspection separately; it never claims to have entered queries, logged in, submitted a contact form or completed a purchase. Recorded field metadata omits field values. Configuration drafts reuse observed field labels and purchase controls as visibility assertions; owners still add permitted interactions and their success conditions before verification. Existing saved reports need fresh discovery to gain the new control observations and proposed steps; rendering also filters duplicate legacy suggestions.

Flow locators use exact names and only the first saved locator. Ambiguous or missing action targets produce maintenance failures without replacement or automatic target changes. Ordinary tests retain their existing fallback behavior. UI controls enforce the creation/verification/activation sequence; this is not a new database-enforced approval system.

The current editor is manual and template-based, not an automatic multi-page AI flow builder. External checkout navigation and authenticated account completion are not guaranteed. Owners must configure permitted test actions and avoid real purchases or destructive submissions.

## Operation

Discovery uses existing `scan_status`. Audit requests set `overview.audit_requested` and `scan_status=pending` together. In-progress audit snapshots preserve that marker and discovered candidates; completed audits clear it. Discovery preserves an existing completed audit. No schema changes are required. On-demand audit measurements still use the existing worker pipeline.

Validation: `node --test backend/worker/scripts/customer-flows.test.mjs`, existing outcome/evidence tests, and frontend build.

## Run evidence and landing page

The landing page promotes configurable customer journeys and presents the audit as optional. The editor accepts a short plain-language goal and manually configured steps; the goal does not generate steps automatically. Each new run records executed steps, targets, observed URL, duration and stopping error. Fill values are redacted from this trace. Failed runs retain the existing screenshot/diagnostic UI. No executed steps are invented for stages after the failure. Test with `node --experimental-strip-types --test frontend/tests/customerFlows.test.mjs` and the backend customer-flow/outcome tests.
