// Fixed overview format. Verdicts follow cloudflare/security-audit-skill:
// confirmed = observed problem with a severity; needs_validation = could not measure, no severity; rejected = checked and fine.
export const SCHEMA_VERSION = 1;

const GROUPS = new Set(['availability', 'performance', 'network', 'content', 'text', 'seo', 'security', 'compliance']);
const SEVERITIES = { high: 'fail', medium: 'fail', low: 'warn', hardening: 'warn' };
const UNSCORED = { rejected: 'pass', needs_validation: 'warn' };
const ARCH_LISTS = ['cdn', 'services', 'third_parties', 'apis', 'forms', 'cookies'];

function checkErrors(checks, need) {
  need(Array.isArray(checks), 'checks');
  const ids = new Set();
  for (const c of checks ?? []) {
    const at = `checks.${c.id}`;
    need(typeof c.id === 'string' && !ids.has(c.id), `${at}: missing or duplicate id`);
    ids.add(c.id);
    need(GROUPS.has(c.group), `${at}: group`);
    need(typeof c.label === 'string' && typeof c.detail === 'string', `${at}: label/detail`);
    if (c.verdict === 'confirmed') {
      need(c.severity in SEVERITIES, `${at}: confirmed without severity`);
      need(c.status === SEVERITIES[c.severity], `${at}: status does not match severity`);
    } else {
      need(c.verdict in UNSCORED, `${at}: verdict`);
      need(c.severity === undefined, `${at}: severity only allowed on confirmed`);
      need(c.status === UNSCORED[c.verdict], `${at}: status does not match verdict`);
    }
  }
}

function collector() {
  const errors = [];
  const need = (ok, msg) => { if (!ok) errors.push(msg); };
  const done = (value) => {
    if (errors.length) throw new Error(`Invalid report: ${errors.slice(0, 5).join('; ')}`);
    return value;
  };
  return { need, done };
}

export function validateChecks(checks) {
  const { need, done } = collector();
  checkErrors(checks, need);
  return done(checks);
}

export function validateOverview(o) {
  const { need, done } = collector();

  need(o.schema_version === SCHEMA_VERSION, 'schema_version');
  need(typeof o.blocked === 'boolean', 'blocked');
  checkErrors(o.checks, need);

  if (!o.blocked) {
    need(Number.isInteger(o.score) && o.score >= 0 && o.score <= 100, 'score');
    need(Array.isArray(o.map?.nodes) && Array.isArray(o.map?.edges), 'map');
    for (const [a, b] of o.map?.edges ?? []) need(o.map.nodes[a] && o.map.nodes[b], 'map.edges: invalid index');
    for (const k of ARCH_LISTS) need(Array.isArray(o.architecture?.[k]), `architecture.${k}`);
  }

  return done(o);
}
