import { checkApi, getPath } from '../src/api.mjs';
const base = { method: 'GET', headers: [], body: null, expected_status: 200, max_ms: 5000, rules: [] };
const cases = [
  ['list ok', { ...base, url: 'https://jsonplaceholder.typicode.com/posts', rules: [{ path: 'length', op: '>', value: '0' }, { path: '[0].userId', op: '==', value: '1' }] }],
  ['rule fail', { ...base, url: 'https://jsonplaceholder.typicode.com/posts/1', rules: [{ path: 'title', op: 'contains', value: 'zzz' }, { path: 'missing.x', op: 'exists' }] }],
  ['status fail', { ...base, url: 'https://jsonplaceholder.typicode.com/nope-404' }],
  ['text', { ...base, url: 'https://www.python.org/', rules: [{ op: 'text_contains', value: 'Python' }] }],
  ['post', { ...base, method: 'POST', url: 'https://jsonplaceholder.typicode.com/posts', headers: [{ name: 'Content-Type', value: 'application/json' }], body: '{"title":"x"}', expected_status: 201, rules: [{ path: 'title', op: '==', value: '"x"' }] }],
  ['localhost', { ...base, url: 'http://localhost:3000/' }],
  ['metadata', { ...base, url: 'http://169.254.169.254/latest/meta-data/' }],
  ['private', { ...base, url: 'http://192.168.1.1/' }],
  ['ipv6 loopback', { ...base, url: 'http://[::1]/' }],
  ['bad dns', { ...base, url: 'https://does-not-exist-fg-12345.example/' }],
];
for (const [n, m] of cases) {
  const r = await checkApi(m);
  console.log('==', n, r.status, r.http_status, r.duration_ms + 'ms', r.error ?? '', JSON.stringify(r.failures.map(f => f.message)));
}
console.log('== proto', getPath({}, '__proto__.constructor'), getPath({ a: [1, 2] }, 'a.length'));
