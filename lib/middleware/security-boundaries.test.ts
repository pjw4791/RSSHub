import { afterEach, describe, expect, it } from 'vitest';
import app from '@/app';
import { config } from '@/config';
import cacheModule from '@/utils/cache';
import xxhash from 'xxhash-wasm';
import { getDebugInfo } from '@/utils/debug-info';

const originalDebug = config.debugInfo;
afterEach(() => {
    config.debugInfo = originalDebug;
});

describe('debug security boundaries', () => {
    it.each([
        ['false', ''],
        ['test-secret', ''],
        ['test-secret', '&debug=wrong'],
    ])('disables debug formats for setting %s and query %s', async (setting, query) => {
        config.debugInfo = setting;
        const response = await app.request(`/test/1?format=0.debug.html${query}`);
        expect(response.headers.get('content-type')).not.toContain('text/html');
        const json = await app.request(`/test/1?format=debug.json${query}`);
        expect(json.headers.get('content-type')).not.toContain('application/json');
    });
    it('isolates enabled HTML previews and forbids shared caching', async () => {
        config.debugInfo = 'test-secret';
        const response = await app.request('/test/1?format=0.debug.html&debug=test-secret');
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(response.headers.get('content-security-policy')).toContain('sandbox;');
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
        expect(response.headers.get('content-security-policy')).not.toContain('allow-scripts');
        expect(response.headers.get('content-security-policy')).not.toContain('allow-same-origin');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
    });
    it('does not retain or publish raw credential-bearing request paths', async () => {
        config.debugInfo = 'true';
        await app.request('/test/1');
        await app.request('/unknown/private-test-credential');
        const page = await (await app.request('/')).text();
        expect(page).not.toContain('private-test-credential');
        expect(JSON.stringify(getDebugInfo())).not.toContain('private-test-credential');
        expect(page).toContain('Hot Routes');
    });
});

it('rejects the old Xiaoyuzhou outer cache without configured credentials', async () => {
    const previous = { ...config.xiaoyuzhou };
    const { h64ToString } = await xxhash();
    const key = 'rsshub:koa-redis-cache:' + h64ToString('/xiaoyuzhou');
    await cacheModule.globalCache.set(key, JSON.stringify({ title: 'old-account-feed', item: [] }), 300);
    try {
        config.xiaoyuzhou.device_id = undefined;
        config.xiaoyuzhou.refresh_token = undefined;
        const response = await app.request('/xiaoyuzhou');
        expect(response.status).toBe(503);
        expect(await response.text()).not.toContain('old-account-feed');
        expect(response.headers.get('RSSHub-Cache-Status')).not.toBe('HIT');
    } finally {
        Object.assign(config.xiaoyuzhou, previous);
    }
});
