import { beforeEach, expect, it, vi } from 'vitest';
import { route } from '@/routes/nikkei/cn';
import got from '@/utils/got';
import cache from '@/utils/cache';
const mocks = vi.hoisted(() => ({ parseURL: vi.fn(), parseString: vi.fn() }));
vi.mock('rss-parser', () => ({
    default: class {
        parseURL = mocks.parseURL;
        parseString = mocks.parseString;
    },
}));
vi.mock('@/utils/got', () => ({ default: vi.fn() }));
vi.mock('@/utils/cache', () => ({ default: { tryGet: vi.fn((_key, callback) => callback()) } }));
const context = (path: string) => ({ req: { path, query: () => {} } });
const run = (path: string) => (route.handler as (ctx: unknown) => Promise<unknown>)(context(path));
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(got).mockResolvedValue({ data: '<title>News</title>', body: '<rss />' });
    mocks.parseURL.mockResolvedValue({ items: [] });
    mocks.parseString.mockResolvedValue({ items: [] });
});
it.each(['/nikkei/cn/cn.attacker.example/', '/nikkei/cn/cn@127.0.0.1/'])('keeps namespace suffix %s on the official origin', async (path) => {
    await run(path);
    const url = new URL(vi.mocked(got).mock.calls[0][0].url);
    expect(url.origin).toBe('https://cn.nikkei.com');
    expect(url.username).toBe('');
});
it('keeps a normal category without allowing redirects', async () => {
    await run('/nikkei/cn/cn/china/ceconomy');
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://cn.nikkei.com/china/ceconomy', redirect: 'error' }));
});
it('parses official traditional Chinese RSS through guarded transport', async () => {
    await run('/nikkei/cn/zh/rss');
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://zh.cn.nikkei.com/rss.html', redirect: 'error' }));
    expect(mocks.parseURL).not.toHaveBeenCalled();
    expect(mocks.parseString).toHaveBeenCalled();
});
it('rejects an external HTML article before detail fetching', async () => {
    vi.mocked(got).mockResolvedValue({ data: '<dt><a href="http://127.0.0.1/private">bad</a></dt>' });
    await expect(run('/nikkei/cn/cn/china')).rejects.toThrow();
    expect(got).toHaveBeenCalledTimes(1);
});
it('rejects an external RSS article before detail fetching', async () => {
    mocks.parseString.mockResolvedValue({ items: [{ title: 'bad', link: 'https://evil.test/private' }] });
    mocks.parseURL.mockResolvedValue({ items: [{ title: 'bad', link: 'https://evil.test/private' }] });
    await expect(run('/nikkei/cn/zh/rss')).rejects.toThrow();
    expect(got).toHaveBeenCalledTimes(1);
});
it('preserves relative articles and prevents detail redirects', async () => {
    vi.mocked(got).mockResolvedValueOnce({ data: '<dt><a href="/china/123-2026-10-24-10-00-00.html">news</a></dt>' });
    await run('/nikkei/cn/cn/china');
    expect(got).toHaveBeenLastCalledWith(expect.objectContaining({ url: 'https://cn.nikkei.com/china/123-2026-10-24-10-00-00.html?print=1', redirect: 'error' }));
});

it('preserves the legacy default route', async () => {
    await run('/nikkei/cn');
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://cn.nikkei.com/cn', redirect: 'error' }));
});
it('rejects credentials even on an official article host', async () => {
    vi.mocked(got).mockResolvedValue({ data: '<dt><a href="https://user@cn.nikkei.com/private">bad</a></dt>' });
    await expect(run('/nikkei/cn/cn/china')).rejects.toThrow();
    expect(got).toHaveBeenCalledTimes(1);
});

it('does not reuse an article cache entry predating origin checks', async () => {
    vi.mocked(got).mockResolvedValueOnce({ data: '<dt><a href="/china/123-2026-10-24-10-00-00.html">news</a></dt>' });
    await run('/nikkei/cn/cn/china');
    expect(cache.tryGet).toHaveBeenCalledWith('nikkei-origin-v2:https://cn.nikkei.com/china/123-2026-10-24-10-00-00.html', expect.any(Function));
});
