import http from 'node:http';

const LOGIN = `<!doctype html><title>Demo</title><form id=f><input name=user aria-label=user><input type=password name=pw aria-label=pw>
<button type=button>Continue with Google</button><button type=submit>Sign in</button></form>
<script>f.onsubmit=async e=>{e.preventDefault();
const r=await fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},
body:JSON.stringify({user:f.user.value,pw:f.pw.value})});
if(r.ok){location.reload()}else{f.insertAdjacentHTML('beforeend','<p role=alert>Invalid credentials</p>')}}</script>`;
const HOME = `<!doctype html><title>Demo</title><h1>Home</h1><a href="/settings">Settings</a> <a href="/logout">Log out</a>
<script>fetch('/api/items?select=*&id=eq.123',{headers:{authorization:'Bearer SECRET-TOKEN-123'}})</script>`;
const SETTINGS = `<!doctype html><title>Settings</title><h1>Settings</h1>
<script>fetch('/api/settings/42');fetch('/api/settings/123e4567-e89b-12d3-a456-426614174000')</script>`;
const OPENAPI = { openapi: '3.0.0', paths: { '/api/items': { get: {}, post: {} }, '/api/settings/{id}': { get: {}, put: {} } } };

/** Tiny app with a username/password form (user qa / password good) and a cookie session. Returns { url, close }. */
export async function startFixtureApp() {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/login') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const { user, pw } = JSON.parse(body);
        if (user === 'qa' && pw === 'good') {
          res.writeHead(200, { 'set-cookie': 'session=ok; Path=/' }).end('{}');
        } else {
          res.writeHead(401).end('{}');
        }
      });
      return;
    }
    const signedIn = /session=ok/.test(req.headers.cookie ?? '');
    if (req.url === '/openapi.json') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(OPENAPI));
    if (req.url.startsWith('/api/')) return res.writeHead(200, { 'content-type': 'application/json' }).end('[]');
    if (req.url === '/settings' && signedIn) return res.writeHead(200, { 'content-type': 'text/html' }).end(SETTINGS);
    res.writeHead(200, { 'content-type': 'text/html' }).end(signedIn ? HOME : LOGIN);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}
