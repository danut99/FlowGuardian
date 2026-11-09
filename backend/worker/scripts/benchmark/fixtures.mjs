import http from 'node:http';

// Bind only to loopback. These endpoints intentionally simulate broken websites.
export async function startFixtures() {
  let transientVisits = 0;
  const server = http.createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    if (path === '/slow') return; // Intentionally never sends headers: real navigation timeout.
    if (path === '/blocked' || path === '/limited') {
      response.writeHead(path === '/blocked' ? 403 : 429);
      return response.end('<h1>Access denied</h1>');
    }
    if (path === '/server-error' || (path === '/transient' && transientVisits++ === 0)) {
      response.writeHead(500);
      return response.end('<h1>Server failure</h1>');
    }
    if (path === '/broken-form') {
      return response.end('<button type="button">Contact</button><p>The button deliberately does nothing.</p>');
    }
    if (path === '/changed-selector') {
      return response.end('<button id="new-contact" type="button">Contact</button>');
    }
    response.end('<h1>Healthy page</h1><button type="button" onclick="document.querySelector(\'form\').hidden=false">Contact</button><form hidden><label>Email<input type="email"></label></form>');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    reset: () => { transientVisits = 0; },
    close: async () => {
      const closed = new Promise((resolve) => server.close(resolve));
      server.closeAllConnections();
      await closed;
    },
  };
}
