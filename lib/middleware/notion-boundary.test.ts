import { afterEach, expect, it, vi } from 'vitest';
import { config } from '@/config';
import { route } from '@/routes/notion/database';
import cacheMiddleware from '@/middleware/cache';
import cacheModule from '@/utils/cache';
import { Hono } from 'hono';
import xxhash from 'xxhash-wasm';

const mocks = vi.hoisted(() => ({ retrieve: vi.fn(), query: vi.fn() }));
vi.mock('@notionhq/client', () => ({
    Client: class {
        databases = mocks;
    },
    isNotionClientError: () => false,
    APIErrorCode: {},
}));
const original = config.notion.key;
afterEach(() => {
    config.notion.key = original;
    vi.clearAllMocks();
});
function context(query: unknown) {
    return { req: { param: () => 'allowed-db', query: (key: string) => (key === 'query' ? JSON.stringify(query) : undefined) } };
}
it('rejects database identity override before calling Notion', async () => {
    config.notion.key = 'fake-token';
    await expect((route.handler as (ctx: unknown) => Promise<unknown>)(context({ database_id: 'other-db' }))).rejects.toThrow();
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
});
it('preserves supported query options and the authorized path database', async () => {
    config.notion.key = 'fake-token';
    mocks.retrieve.mockResolvedValue({ title: [], description: [], url: 'https://notion.test/allowed-db' });
    mocks.query.mockResolvedValue({ results: [] });
    const query = { filter: { property: 'Published', checkbox: { equals: true } }, sorts: [], page_size: 20, start_cursor: 'cursor', filter_properties: ['title'], archived: false, in_trash: false };
    await (route.handler as (ctx: unknown) => Promise<unknown>)(context(query));
    expect(mocks.query).toHaveBeenCalledWith({ ...query, database_id: 'allowed-db' });
});
it('does not reuse old or differently filtered Notion outer cache', async () => {
    const path = '/notion/database/cache-test-db';
    const { h64ToString } = await xxhash();
    await cacheModule.globalCache.set('rsshub:koa-redis-cache:' + h64ToString(path), JSON.stringify({ title: 'old-wrong-db' }), 300);
    const app = new Hono();
    app.use(cacheMiddleware);
    app.get(path, (ctx) => {
        if (!ctx.get('data')) {
            ctx.set('data', { title: ctx.req.query('query') });
        }
        return ctx.json(ctx.get('data'));
    });
    expect(await (await app.request(path + '?query=first')).json()).toEqual({ title: 'first' });
    expect(await (await app.request(path + '?query=second')).json()).toEqual({ title: 'second' });
});
