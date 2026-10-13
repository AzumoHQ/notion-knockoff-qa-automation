import fs from 'node:fs';
import path from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import { endpointTemplate } from './normalize.js';

const pick = (object, dotted) => dotted.split('.').reduce((value, key) => value?.[key], object);

/** Reads a bearer token out of a saved storage state (localStorage entry whose key matches `keyPattern`). */
export function tokenFromStorageState(file, { keyPattern, tokenPath = '' }) {
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const regex = new RegExp(keyPattern);
  for (const origin of state.origins ?? []) {
    const entry = origin.localStorage?.find((item) => regex.test(item.name));
    if (!entry) continue;
    if (!tokenPath) return entry.value;
    return pick(JSON.parse(entry.value), tokenPath);
  }
  throw new Error(`No localStorage key matching /${keyPattern}/ in ${path.basename(file)}`);
}

/**
 * Thin API client over Playwright's request context, shared by API tests, seed and cleanup.
 * Auth modes (api/api.config.js `auth.mode`):
 *   none | cookies (storage state cookies) | bearer-localstorage (token from a storage state) |
 *   login-endpoint (POST credentials from env; logs in again once on a 401).
 * Calls are recorded as method + path template only: no headers, bodies or query values.
 */
export class ApiSession {
  constructor({ config, env = process.env, root = process.cwd(), profiles = {}, playwright = playwrightRequest }) {
    this.config = config;
    this.env = env;
    this.root = root;
    this.profiles = profiles;
    this.playwright = playwright;
    this.calls = [];
    this.project = '';
    this.context = null;
  }

  static async create(options) {
    const session = new ApiSession(options);
    await session.open();
    return session;
  }

  get baseURL() {
    return this.config.baseURL ?? this.env.API_BASE_URL ?? this.env.BASE_URL;
  }

  async open() {
    await this.context?.dispose();
    const { auth = { mode: 'none' } } = this.config;
    const headers = { ...this.config.headers };
    const options = { baseURL: this.baseURL };
    const profile = this.profiles[auth.profile ?? 'default'];
    const stateFile = profile && path.resolve(this.root, profile.storageStatePath);
    if (auth.mode === 'cookies') options.storageState = stateFile;
    if (auth.mode === 'bearer-localstorage') headers.Authorization = `Bearer ${tokenFromStorageState(stateFile, auth)}`;
    if (auth.mode === 'login-endpoint') headers.Authorization = `Bearer ${await this.login(auth)}`;
    this.context = await this.playwright.newContext({ ...options, extraHTTPHeaders: headers });
  }

  async login(auth) {
    const keys = this.profiles[auth.profile ?? 'default']?.credentialsEnvPrefix;
    const username = this.env[`${keys}_USERNAME`];
    const password = this.env[`${keys}_PASSWORD`];
    if (!username || !password) throw new Error(`login-endpoint needs ${keys}_USERNAME and ${keys}_PASSWORD`);
    const body = JSON.parse(JSON.stringify(auth.body ?? {}).replaceAll('{username}', username).replaceAll('{password}', password));
    const login = await this.playwright.newContext({ baseURL: this.baseURL, extraHTTPHeaders: this.config.headers });
    try {
      const response = await login.fetch(auth.url, { method: auth.method ?? 'POST', data: body });
      if (!response.ok()) throw new Error(`login endpoint answered ${response.status()}`);
      const token = pick(await response.json(), auth.tokenPath ?? 'token');
      if (!token) throw new Error(`login response has no "${auth.tokenPath ?? 'token'}"`);
      return token;
    } finally {
      await login.dispose();
    }
  }

  async fetch(method, url, options = {}) {
    let response = await this.context.fetch(url, { method, failOnStatusCode: false, ...options });
    if (response.status() === 401 && this.config.auth?.mode === 'login-endpoint') {
      await this.open();
      response = await this.context.fetch(url, { method, failOnStatusCode: false, ...options });
    }
    const { path: template } = endpointTemplate(url);
    this.calls.push({ method: method.toUpperCase(), path: template, status: response.status(), project: this.project });
    return response;
  }

  get = (url, options) => this.fetch('GET', url, options);
  post = (url, options) => this.fetch('POST', url, options);
  put = (url, options) => this.fetch('PUT', url, options);
  patch = (url, options) => this.fetch('PATCH', url, options);
  delete = (url, options) => this.fetch('DELETE', url, options);

  /** Parsed JSON body, or an Error naming status and a short body excerpt (never headers). */
  async json(response, what = 'request') {
    if (!response.ok()) throw new Error(`${what} failed: ${response.status()} ${(await response.text()).slice(0, 200)}`);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  async dispose() {
    await this.context?.dispose();
  }
}
