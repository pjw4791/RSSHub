import { afterEach, expect, it } from 'vitest';
import { Hono } from 'hono';
import xxhash from 'xxhash-wasm';
import cacheMiddleware from '@/middleware/cache';
import cache from '@/utils/cache';
import { config } from '@/config';
import { route } from '@/routes/discuz/discuz';
const previous = config.feature.allow_user_supply_unsafe_domain;
afterEach(() => {
    config.feature.allow_user_supply_unsafe_domain = previous;
});
it('rejects a previously cached feed when unsafe-domain mode is disabled', async () => {
    const path = '/discuz/x/https://forum.test/list';
    const { h64ToString } = await xxhash();
    await cache.globalCache.set('rsshub:koa-redis-cache:' + h64ToString(path), JSON.stringify({ title: 'cached-private-content' }), 300);
    config.feature.allow_user_supply_unsafe_domain = false;
    const app = new Hono();
    app.use(cacheMiddleware);
    app.get('*', async (ctx) => {
        if (ctx.get('data')) {
            return ctx.json(ctx.get('data'));
        }
        try {
            await (route.handler as (ctx: unknown) => Promise<unknown>)(ctx);
            return ctx.text('unexpected');
        } catch {
            return ctx.text('disabled', 503);
        }
    });
    const res = await app.request(path);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('disabled');
});
