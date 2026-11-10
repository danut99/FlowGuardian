export function approvedOrigins(steps, siteUrl) {
  const origins = new Set([new URL(siteUrl).origin]);
  const config = steps.find(s => s.action === 'goto')?.locators?.find(l => l.type === 'flow_config');
  for (const value of (config?.allowed_origins ?? []).slice(0,5)) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.origin !== value) throw new Error('Additional destinations must be exact HTTPS origins.');
    origins.add(url.origin);
  }
  return origins;
}
