// API Guardian: one HTTP request per monitor, judged on status, speed and JSON rules.
import dns from 'node:dns/promises';
import net from 'node:net';

const TIMEOUT_MS = 30_000;
const MAX_BODY = 1_000_000;
const SAMPLE = 2000;
const USER_AGENT = 'FlowGuardian-API-Guardian/1.0 (+uptime monitoring)';

function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

function privateIp(ip) {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

// The worker runs inside cloud infrastructure: never let a user point it at internal addresses
async function assertPublic(url) {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!ips.length || ips.some(privateIp)) throw new Error('Adresa duce către o rețea privată și nu poate fi verificată.');
}

async function readBody(res) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < MAX_BODY) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  return Buffer.concat(chunks).toString('utf8').slice(0, MAX_BODY);
}

// "data.items[0].id" → walks own properties only (plus .length), no eval
export function getPath(obj, path) {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cur = obj;
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object' && typeof cur !== 'string') return undefined;
    if (k === 'length' && (Array.isArray(cur) || typeof cur === 'string')) cur = cur.length;
    else if (typeof cur === 'object' && Object.hasOwn(cur, k)) cur = cur[k];
    else return undefined;
  }
  return cur;
}

const parse = (v) => { try { return JSON.parse(v); } catch { return v; } };
const same = (a, b) => (typeof a === 'object' || typeof b === 'object' ? JSON.stringify(a) === JSON.stringify(b) : String(a) === String(b));
const show = (v) => (v === undefined ? 'lipsește' : typeof v === 'string' ? v.slice(0, 120) : JSON.stringify(v)?.slice(0, 120));

export function evalRule(rule, json, text) {
  if (rule.op === 'text_contains') return { ok: text.includes(rule.value ?? ''), actual: null };
  if (json === undefined) return { ok: false, actual: 'răspunsul nu e JSON' };
  const actual = getPath(json, rule.path ?? '');
  const expected = parse(rule.value ?? '');
  const num = (v) => (typeof v === 'number' ? v : Number(v));
  let ok;
  switch (rule.op) {
    case 'exists': ok = actual !== undefined && actual !== null; break;
    case 'not_exists': ok = actual === undefined || actual === null; break;
    case '==': ok = same(actual, expected); break;
    case '!=': ok = !same(actual, expected); break;
    case '>': ok = num(actual) > num(expected); break;
    case '>=': ok = num(actual) >= num(expected); break;
    case '<': ok = num(actual) < num(expected); break;
    case '<=': ok = num(actual) <= num(expected); break;
    case 'contains':
      ok = Array.isArray(actual) ? actual.some((x) => same(x, expected)) : typeof actual === 'string' && actual.includes(String(expected));
      break;
    default: ok = false;
  }
  return { ok, actual: show(actual) };
}

export async function checkApi(monitor) {
  const url = new URL(monitor.url);
  const headers = new Headers({ 'user-agent': USER_AGENT });
  for (const h of monitor.headers ?? []) {
    try { if (h?.name) headers.set(h.name, h.value ?? ''); } catch { /* invalid header name: skip */ }
  }
  const started = Date.now();
  let res, text;
  try {
    await assertPublic(url);
    res = await fetch(url, {
      method: monitor.method,
      headers,
      body: ['GET', 'HEAD'].includes(monitor.method) || !monitor.body ? undefined : monitor.body,
      // Following redirects could land on an internal address we didn't vet
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    text = monitor.method === 'HEAD' ? '' : await readBody(res);
  } catch (e) {
    const code = e?.cause?.code ?? e?.code;
    const msg = e?.name === 'TimeoutError' ? `Nu a răspuns în ${TIMEOUT_MS / 1000} s.`
      : code === 'ENOTFOUND' ? 'Domeniul nu există sau nu are DNS (ENOTFOUND).'
      : code ? `Nu am putut conecta (${code}).` : e?.message ?? String(e);
    return { status: 'error', http_status: null, duration_ms: Date.now() - started, error: msg, failures: [], response_sample: null };
  }
  const duration = Date.now() - started;

  const failures = [];
  if (res.status !== monitor.expected_status) {
    failures.push({ kind: 'status', message: `Status HTTP ${res.status} (așteptat ${monitor.expected_status})` });
  }
  if (duration > monitor.max_ms) {
    failures.push({ kind: 'speed', message: `Răspuns în ${duration} ms (limita ${monitor.max_ms} ms)` });
  }
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  for (const rule of monitor.rules ?? []) {
    const r = evalRule(rule, json, text);
    if (!r.ok) {
      const what = rule.op === 'text_contains' ? `răspunsul nu conține „${rule.value}”` : `${rule.path} ${rule.op} ${rule.value ?? ''}`.trim();
      failures.push({ kind: 'rule', rule, message: `Regula „${what}” nu e respectată${r.actual != null ? ` (valoare: ${r.actual})` : ''}` });
    }
  }

  return {
    status: failures.length ? 'failed' : 'passed',
    http_status: res.status,
    duration_ms: duration,
    error: null,
    failures,
    // Only kept for failures, so the user can see what came back
    response_sample: failures.length ? text.slice(0, SAMPLE) : null,
  };
}
