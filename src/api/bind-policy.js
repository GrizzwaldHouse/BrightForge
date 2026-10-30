/**
 * bind-policy.js - Decide which network interface the server listens on.
 *
 * Default: loopback only (127.0.0.1). Binding to any other address must be
 * requested explicitly (BRIGHTFORGE_HOST env var or web_server.host in
 * config/agent-config.yaml) AND requires BRIGHTFORGE_API_KEY, because the
 * API can write files, run git and spend provider budget.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date October 2026
 */

import { isSelfTest } from '../core/is-main-module.js';

export const DEFAULT_HOST = '127.0.0.1';

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * @param {string} host
 * @returns {boolean} true for loopback addresses (127.0.0.0/8, ::1, localhost)
 */
export function isLoopbackHost(host) {
  if (typeof host !== 'string' || host.length === 0) return false;
  const h = host.trim().toLowerCase();
  if (LOOPBACK_NAMES.has(h)) return true;
  if (h.startsWith('::ffff:')) return isLoopbackHost(h.slice(7));
  return /^127(\.\d{1,3}){3}$/.test(h);
}

/**
 * Resolve the bind host and refuse unsafe combinations.
 * @param {object} [opts]
 * @param {object} [opts.env=process.env]
 * @param {string} [opts.configHost] - web_server.host from config
 * @returns {{ host: string, authRequired: boolean, source: string }}
 * @throws {Error} code BIND_REQUIRES_API_KEY when a non-loopback host is requested without an API key
 */
export function resolveBindPolicy({ env = process.env, configHost } = {}) {
  let host = DEFAULT_HOST;
  let source = 'default';
  if (env.BRIGHTFORGE_HOST && env.BRIGHTFORGE_HOST.trim()) {
    host = env.BRIGHTFORGE_HOST.trim();
    source = 'BRIGHTFORGE_HOST';
  } else if (typeof configHost === 'string' && configHost.trim()) {
    host = configHost.trim();
    source = 'config';
  }

  const hasKey = typeof env.BRIGHTFORGE_API_KEY === 'string' && env.BRIGHTFORGE_API_KEY.length > 0;
  if (!isLoopbackHost(host) && !hasKey) {
    const err = new Error(
      `Refusing to listen on non-loopback host "${host}" without BRIGHTFORGE_API_KEY. ` +
      'Set BRIGHTFORGE_API_KEY, or bind to 127.0.0.1.'
    );
    err.code = 'BIND_REQUIRES_API_KEY';
    throw err;
  }

  return { host, authRequired: hasKey, source };
}

// --test block
if (isSelfTest(import.meta.url)) {
  console.log('[BIND] Running self-test...');
  let failed = 0;
  const check = (cond, label) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}: ${label}`);
    if (!cond) failed++;
  };

  check(resolveBindPolicy({ env: {} }).host === '127.0.0.1', 'default host is 127.0.0.1');
  check(resolveBindPolicy({ env: {} }).authRequired === false, 'no key -> auth not required (loopback only)');
  check(resolveBindPolicy({ env: { BRIGHTFORGE_HOST: 'localhost' } }).host === 'localhost', 'explicit localhost allowed without key');
  check(resolveBindPolicy({ env: { BRIGHTFORGE_HOST: '::1' } }).host === '::1', 'IPv6 loopback allowed without key');

  let refused = null;
  try { resolveBindPolicy({ env: { BRIGHTFORGE_HOST: '0.0.0.0' } }); } catch (e) { refused = e.code; }
  check(refused === 'BIND_REQUIRES_API_KEY', '0.0.0.0 without key is refused');

  refused = null;
  try { resolveBindPolicy({ env: {}, configHost: '192.168.1.10' }); } catch (e) { refused = e.code; }
  check(refused === 'BIND_REQUIRES_API_KEY', 'LAN address from config without key is refused');

  const withKey = resolveBindPolicy({ env: { BRIGHTFORGE_HOST: '0.0.0.0', BRIGHTFORGE_API_KEY: 'x'.repeat(32) } });
  check(withKey.host === '0.0.0.0' && withKey.authRequired === true, '0.0.0.0 with key allowed and auth required');

  check(isLoopbackHost('127.10.0.1') && isLoopbackHost('::ffff:127.0.0.1'), 'loopback forms recognised');
  check(!isLoopbackHost('0.0.0.0') && !isLoopbackHost('10.0.0.1') && !isLoopbackHost(''), 'non-loopback forms rejected');

  console.log(`[BIND] ${failed === 0 ? 'Self-test passed' : `${failed} check(s) failed`}`);
  process.exit(failed === 0 ? 0 : 1);
}
