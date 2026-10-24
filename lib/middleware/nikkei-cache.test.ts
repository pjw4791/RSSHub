import { expect, it } from 'vitest';
import cacheMiddleware from '@/middleware/cache';
import cacheModule from '@/utils/cache';
import { Hono } from 'hono';
import xxhash from 'xxhash-wasm';
it('does not reuse Nikkei results cached before origin validation', async () => {
    const path = '/nikkei/cn/cn.attacker.example/';
    const { h64ToString } = await xxhash();
    await cacheModule.globalCache.set('rsshub:koa-redis-cache:' + h64ToString(path), JSON.stringify({ title: 'old-external-feed' }), 300);
    const app = new Hono();
    app.use(cacheMiddleware);
    app.get(path, (ctx) => {
        if (!ctx.get('data')) {
            ctx.set('data', { title: 'validated-source' });
        }
        return ctx.json(ctx.get('data'));
    });
    expect(await (await app.request(path)).json()).toEqual({ title: 'validated-source' });
});
