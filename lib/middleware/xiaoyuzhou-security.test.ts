import { afterEach, expect, it, vi } from 'vitest';
import { config } from '@/config';
import { route } from '@/routes/xiaoyuzhou/pickup';
import cache from '@/utils/cache';

vi.mock('@/utils/cache', () => ({ default: { tryGet: vi.fn(), get: vi.fn(), set: vi.fn() } }));
vi.mock('@/utils/got', () => ({ default: vi.fn() }));
const original = { ...config.xiaoyuzhou };
afterEach(() => {
    Object.assign(config.xiaoyuzhou, original);
    vi.clearAllMocks();
});
it.each([{}, { device_id: 'test-device' }, { refresh_token: 'test-token' }])('requires configured credentials before cache: %j', async (credentials) => {
    config.xiaoyuzhou.device_id = credentials.device_id;
    config.xiaoyuzhou.refresh_token = credentials.refresh_token;
    await expect((route.handler as () => Promise<unknown>)()).rejects.toThrow('XIAOYUZHOU');
    expect(cache.tryGet).not.toHaveBeenCalled();
    expect(cache.get).not.toHaveBeenCalled();
});
it('uses only the configured credential cache for a valid cached feed', async () => {
    config.xiaoyuzhou.device_id = 'test-device';
    config.xiaoyuzhou.refresh_token = 'test-token';
    vi.mocked(cache.tryGet).mockResolvedValue([{ pubDate: new Date().toISOString(), title: 'public item' }]);
    const result = await (route.handler as () => Promise<{ item: unknown[] }>)();
    expect(result.item).toHaveLength(1);
    expect(vi.mocked(cache.tryGet).mock.calls[0][0]).toMatch(/^xiaoyuzhou_items_[a-f0-9]{32}$/);
    expect(cache.get).not.toHaveBeenCalled();
});
