import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const {
  createInboxClient, allowedRoute, normalizeServer, cleanFileName, newInboundAlert,
} = createRequire(import.meta.url)('../src/main/inbox_client.cjs');

const password = 'contraseña-prueba-no-real';
const form = { server: 'http://127.0.0.1:8156', tenant: 'pabonitas', email: 'prueba@example.test', password, remember: true };
const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5)),
  decryptString: (value) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString(),
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function setup(t, options = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'r3d-inbox-client-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const calls = [];
  let logins = 0;
  let current = '';
  const fetch = async (url, init) => {
    const route = new URL(url).pathname;
    calls.push({ route, method: init.method, authorization: init.headers.Authorization, body: init.body });
    if (route === '/api/v1/auth/login') {
      logins++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      current = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, n: logins })).toString('base64url')}.signature`;
      return json({ access_token: current, must_change_password: false });
    }
    if (route === '/api/v1/users/me') return json({ id: 7, name: 'Agente', email: form.email });
    if (route.startsWith('/api/v1/public/')) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    }
    if (init.headers.Authorization !== `Bearer ${current}`) return json({ detail: 'Invalid token' }, 401);
    if (route.endsWith('/media')) {
      return new Response(new Uint8Array([4, 5]), { headers: { 'content-type': 'image/jpeg', 'content-disposition': 'attachment; filename="foto.jpg"' } });
    }
    return json({ unread_conversations: 2 });
  };
  const configFile = path.join(dir, 'mensajes.json');
  const client = createInboxClient({ configFile, fetch, safeStorage: secureStorage, ...options });
  return { client, configFile, calls, get logins() { return logins; } };
}

test('servidor y rutas aceptan únicamente los destinos previstos', () => {
  assert.equal(normalizeServer('pabonitas.co'), 'https://pabonitas.co');
  assert.equal(normalizeServer('http://127.0.0.1:8156'), 'http://127.0.0.1:8156');
  assert.equal(normalizeServer('http://example.test'), null);
  assert.equal(normalizeServer('https://user:pass@example.test'), null);
  assert.equal(normalizeServer('https://example.test/otro'), null);
  assert.deepEqual(allowedRoute('GET', '/inbox/conversations?view=unread&offset=2'), {
    method: 'GET', path: '/inbox/conversations?view=unread&offset=2',
  });
  for (const route of ['/users', '/inbox/settings', '/inbox/conversations/0', '/inbox/conversations?view=all&view=closed', '/inbox/summary?token=x', '//example.test']) {
    assert.equal(allowedRoute('GET', route), null, route);
  }
  assert.equal(allowedRoute('DELETE', '/inbox/conversations/1'), null);
  assert.equal(cleanFileName('CON.txt'), '_CON.txt');
  assert.doesNotMatch(cleanFileName('../../pedido?.pdf'), /[\\/:*?"<>|]/);
});

test('sesión cifrada, renovación concurrente, reanudación y cierre', async (t) => {
  const env = await setup(t);
  const login = await env.client.login(form);
  assert.equal(login.ok, true);
  assert.equal(login.data.me.id, 7);
  const disk = await fs.readFile(env.configFile, 'utf8');
  assert.doesNotMatch(disk, /contraseña-prueba-no-real|access_token|signature/);
  assert.ok(JSON.parse(disk).password_enc);
  assert.equal(env.client.webUrl('ajustes/canales'), `${form.server}/app/mensajes/ajustes/canales`);
  assert.equal(env.client.webUrl('https://example.test'), `${form.server}/app/mensajes`);
  env.client.invalidateToken();
  const requests = await Promise.all([
    env.client.request('GET', '/inbox/summary'),
    env.client.request('GET', '/inbox/summary'),
  ]);
  assert.ok(requests.every((result) => result.ok && result.data.unread_conversations === 2));
  assert.equal(env.logins, 2, 'las peticiones concurrentes renuevan una sola vez');
  const reopened = createInboxClient({
    configFile: env.configFile,
    safeStorage: secureStorage,
    fetch: async (url) => new URL(url).pathname.endsWith('/auth/login')
      ? json({ access_token: 'resumed', must_change_password: false })
      : json({ id: 7, name: 'Agente', email: form.email }),
  });
  assert.equal((await reopened.resume()).data.signedIn, true);
  assert.equal((await reopened.logout()).data.signedIn, false);
  assert.equal(JSON.parse(await fs.readFile(env.configFile, 'utf8')).password_enc, null);
  assert.equal((await reopened.resume()).ok, false);
});

test('adjuntos se descargan solo desde rutas confiables y la sesión no sale a otro origen', async (t) => {
  const env = await setup(t);
  await env.client.login(form);
  const privateMedia = await env.client.media('/inbox/messages/12/media');
  assert.equal(privateMedia.ok, true);
  assert.equal(privateMedia.data.name, 'foto.jpg');
  assert.deepEqual([...privateMedia.data.bytes], [4, 5]);
  const publicMedia = await env.client.media(`${form.server}/api/v1/public/assets/2/content?variant=thumbnail`);
  assert.equal(publicMedia.ok, true);
  const publicCall = env.calls.find((call) => call.route.startsWith('/api/v1/public/'));
  assert.equal(publicCall.authorization, undefined);
  const count = env.calls.length;
  for (const ref of ['https://otro.example/api/v1/public/assets/2/content?variant=thumbnail', '/inbox/settings', '/api/v1/public/assets/2/content?variant=thumbnail&x=1']) {
    assert.equal((await env.client.media(ref)).ok, false);
  }
  assert.equal(env.calls.length, count);
  assert.equal((await env.client.request('GET', '/inbox/settings')).status, 400);
});

test('cerrar sesión durante un ingreso pendiente impide reabrirla', async (t) => {
  let release;
  let started;
  const entered = new Promise((resolve) => { started = resolve; });
  const pendingResponse = new Promise((resolve) => { release = resolve; });
  const env = await setup(t, {
    fetch: async (url) => {
      if (new URL(url).pathname.endsWith('/auth/login')) {
        started();
        await pendingResponse;
        return json({ access_token: 'delayed', must_change_password: false });
      }
      return json({ id: 7, name: 'Agente' });
    },
  });
  const login = env.client.login(form);
  await entered;
  await env.client.logout();
  release();
  assert.equal((await login).ok, false);
  assert.equal((await env.client.state()).signedIn, false);
});

test('una petición pendiente no se reenvía con la sesión de otra cuenta', async (t) => {
  let release, started, logins = 0;
  const entered = new Promise((resolve) => { started = resolve; });
  const response = new Promise((resolve) => { release = resolve; });
  const sends = [];
  const env = await setup(t, {
    fetch: async (url, init) => {
      const { pathname, origin } = new URL(url);
      if (pathname.endsWith('/auth/login')) return json({ access_token: `token-${++logins}` });
      if (pathname.endsWith('/users/me')) return json({ id: 7, name: 'Agente' });
      sends.push({ origin, authorization: init.headers.Authorization });
      if (sends.length === 1) { started(); await response; return json({ detail: 'Sesión anterior vencida' }, 401); }
      return json({ sent: true });
    },
  });
  assert.equal((await env.client.login(form)).ok, true);
  const pending = env.client.request('POST', '/inbox/conversations/1/messages', { body: 'Mensaje de la primera cuenta' });
  await entered;
  await env.client.logout();
  assert.equal((await env.client.login({ ...form, server: 'http://127.0.0.1:8157', email: 'otra@example.test' })).ok, true);
  release();
  assert.equal((await pending).ok, false);
  assert.deepEqual(sends, [{ origin: form.server, authorization: 'Bearer token-1' }]);
});

test('una respuesta de la sesión anterior se descarta al cerrar sesión', async (t) => {
  let release, started;
  const entered = new Promise((resolve) => { started = resolve; });
  const response = new Promise((resolve) => { release = resolve; });
  const env = await setup(t, {
    fetch: async (url) => {
      const route = new URL(url).pathname;
      if (route.endsWith('/auth/login')) return json({ access_token: 'token-anterior' });
      if (route.endsWith('/users/me')) return json({ id: 7 });
      started();
      await response;
      return json({ unread_conversations: 1 });
    },
  });
  await env.client.login(form);
  const pending = env.client.request('GET', '/inbox/summary');
  await entered;
  await env.client.logout();
  release();
  assert.equal((await pending).status, 401);
});

test('notificaciones solo describen mensajes entrantes nuevos y no leídos', () => {
  const summary = {
    latest_inbound_at: '2026-11-10T12:00:00Z', unread_messages: 1,
    recent_unread: [{ id: 3, display_name: 'Ana', platform_label: 'WhatsApp', last_inbound_at: '2026-11-10T12:00:00Z', last_message_preview: 'Hola' }],
  };
  assert.equal(newInboundAlert(Date.parse('2026-11-10T11:00:00Z'), summary).conversationId, 3);
  assert.equal(newInboundAlert(Date.parse('2026-11-10T12:00:00Z'), summary), null);
  assert.equal(newInboundAlert(null, { ...summary, unread_messages: 0 }), null);
});
