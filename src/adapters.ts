/**
 * Adapter seams — the irreducible per-app contracts. The QA engine is generic; the
 * two things only the app can provide are HOW to authenticate and HOW to get
 * isolated test data. Implement these in your repo and pass them to `createTest`;
 * everything else (self-healing, reporters, gates) comes from the package.
 */
import { test as base, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';

/** A cookie to inject into the browser context (the common cross-stack auth shape). */
export interface AuthCookie { name: string; value: string }

/** How the app authenticates a given role for a test (API login, token mint, SSO stub…). */
export interface AuthAdapter<Role extends string = string> {
  /** Return cookies (and/or set storage state) that authenticate `role`. */
  login(role: Role, ctx: { context: BrowserContext; baseURL?: string; workspaceId?: string }): Promise<AuthCookie[] | void>;
}

/** How the app provisions and tears down isolated test data per test. */
export interface TestDataSeam<Opts = unknown> {
  provision(opts?: Opts): Promise<{ workspaceId: string }>;
  teardown(ws: { workspaceId: string }): Promise<void>;
}

export interface QaFixtureDeps<Role extends string = string, Opts = unknown> {
  auth: AuthAdapter<Role>;
  data?: TestDataSeam<Opts>;
}

/**
 * Build a Playwright `test` with `workspace` + `signInAs` fixtures wired to the
 * injected app adapters. Specs then do `const { test } = createTest({ auth, data })`.
 */
export function createTest<Role extends string = string, Opts = unknown>(deps: QaFixtureDeps<Role, Opts>) {
  const test = base.extend<{
    workspaceOptions: Opts | undefined;
    workspace: { workspaceId: string } | null;
    signInAs: (role: Role) => Promise<void>;
  }>({
    workspaceOptions: [undefined, { option: true }],
    workspace: async ({ workspaceOptions }, use) => {
      const ws = deps.data ? await deps.data.provision(workspaceOptions as Opts) : null;
      await use(ws);
      if (deps.data && ws) await deps.data.teardown(ws);
    },
    signInAs: async ({ context, baseURL, workspace }, use) => {
      await use(async (role: Role) => {
        const cookies = await deps.auth.login(role, { context, baseURL, workspaceId: workspace?.workspaceId });
        if (Array.isArray(cookies) && cookies.length && baseURL) {
          await context.addCookies(cookies.map((c) => ({ name: c.name, value: c.value, url: baseURL })));
        }
      });
    },
  });
  return { test, expect };
}

export { expect };
