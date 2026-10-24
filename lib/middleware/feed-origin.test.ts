import { beforeEach, expect, it, vi } from 'vitest';
import { route as substack } from '@/routes/substack/subscribe';
import { route as yna } from '@/routes/yna/index';
import { route as minecraft } from '@/routes/minecraft/version';
import got from '@/utils/got';
import parser from '@/utils/rss-parser';

vi.mock('@/utils/got', () => ({ default: vi.fn() }));
vi.mock('@/utils/rss-parser', () => ({ default: { parseURL: vi.fn(), parseString: vi.fn() } }));
vi.mock('@/utils/cache', () => ({ default: { tryGet: (_key, callback) => callback() } }));
beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(got).mockResolvedValue({ data: '', body: '' });
    vi.mocked(parser.parseString).mockResolvedValue({ items: [] });
});
const context = (params = {}, query = {}) => ({ req: { param: (name: string) => params[name], query: (name: string) => query[name] } });
it.each(['evil.test/', 'user@evil.test/', 'bad.name', '//127.0.0.1'])('rejects Substack host syntax %s before fetch', async (user) => {
    await expect((substack.handler as (ctx: unknown) => Promise<unknown>)(context({ user }))).rejects.toThrow();
    expect(got).not.toHaveBeenCalled();
    expect(parser.parseURL).not.toHaveBeenCalled();
});
it('keeps valid Substack feed parsing without redirects', async () => {
    await (substack.handler as (ctx: unknown) => Promise<unknown>)(context({ user: 'valid-news' }));
    expect(got).toHaveBeenCalledWith('https://valid-news.substack.com/feed', { redirect: 'error' });
    expect(parser.parseString).toHaveBeenCalled();
});
it('rejects unknown YNA language before fetching a host', async () => {
    await expect((yna.handler as (ctx: unknown) => Promise<unknown>)(context({ lang: 'evil.test/' }))).rejects.toThrow();
    expect(got).not.toHaveBeenCalled();
    expect(parser.parseURL).not.toHaveBeenCalled();
});
it('does not fetch a private URL supplied by the YNA feed', async () => {
    vi.mocked(parser.parseString).mockResolvedValue({ items: [{ link: 'http://127.0.0.1/private' }] });
    await expect((yna.handler as (ctx: unknown) => Promise<unknown>)(context({ lang: 'ko' }))).rejects.toThrow();
    expect(got).toHaveBeenCalledTimes(1);
});
it('preserves a valid YNA feed and maps documented Spanish host', async () => {
    await (yna.handler as (ctx: unknown) => Promise<unknown>)(context({ lang: 'es' }));
    expect(got).toHaveBeenCalledWith('https://sp.yna.co.kr/RSS/news.xml', { redirect: 'error' });
});
it.each(['http://127.0.0.1/a', 'https://evil.test/manifest.json', 'https://piston-meta.mojang.com@evil.test/a'])('rejects untrusted Minecraft manifest %s', async (url) => {
    await expect((minecraft.handler as (ctx: unknown) => Promise<unknown>)(context({}, { mcmanifest: url }))).rejects.toThrow();
    expect(got).not.toHaveBeenCalled();
});
it('preserves official Minecraft source without redirects', async () => {
    vi.mocked(got).mockResolvedValue({ data: { versions: [] } });
    await (minecraft.handler as (ctx: unknown) => Promise<unknown>)(context());
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', redirect: 'error' }));
});

it('upgrades historical official YNA article links before fetching', async () => {
    vi.mocked(parser.parseString).mockResolvedValue({ items: [{ link: 'http://www.yna.co.kr/view/test', pubDate: '2026-10-24T00:00:00Z' }] });
    await (yna.handler as (ctx: unknown) => Promise<unknown>)(context({ lang: 'ko' }));
    expect(got).toHaveBeenLastCalledWith('https://www.yna.co.kr/view/test', { redirect: 'error' });
});
