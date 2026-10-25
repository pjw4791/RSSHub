import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { route } from '@/routes/discuz/discuz';
import { config } from '@/config';
import ofetch from '@/utils/ofetch';
import cache from '@/utils/cache';
vi.mock('@/utils/ofetch', () => ({ default: { raw: vi.fn() } }));
vi.mock('@/utils/cache', () => ({ default: { tryGet: vi.fn((_key, callback) => callback()) } }));
const previous = { unsafe: config.feature.allow_user_supply_unsafe_domain, discuz: { ...config.discuz } };
const html = (version: string, article = '/thread.html') =>
    `<meta name="generator" content="DISCUZ! ${version}"><title>Forum</title><table><tbody id="normalthread_1"><tr><td><span id="thread_1"><a class="xst" href="${article}">Article</a></span></td></tr></tbody></table>`;
const response = (body: string, status = 200, location?: string) => ({ _data: Buffer.from(body), status, headers: new Headers(location ? { location } : {}) });
const run = (link = 'https://forum.test/list', ver = 'x', cid?: string) => (route.handler as (ctx: unknown) => Promise<any>)({ req: { param: (name: string) => ({ link, ver, cid })[name], query: () => {} } });
beforeEach(() => {
    vi.clearAllMocks();
    config.feature.allow_user_supply_unsafe_domain = true;
    config.discuz.cookies = { '12': 'session=fake' };
    config.discuz.origins = { '12': 'https://forum.test' };
    vi.mocked(ofetch.raw).mockResolvedValue(response(html('X')));
});
afterEach(() => {
    config.feature.allow_user_supply_unsafe_domain = previous.unsafe;
    Object.assign(config.discuz, previous.discuz);
});
it.each(['7', 'x', ''])('requires explicit unsafe-domain opt-in for %s', async (version) => {
    config.feature.allow_user_supply_unsafe_domain = false;
    await expect(run('https://forum.test', version)).rejects.toThrow();
    expect(ofetch.raw).not.toHaveBeenCalled();
});
it.each(['https://evil.test', 'https://forum.test.evil.test', 'https://user@forum.test', 'http://forum.test', 'https://forum.test:8443'])('does not send a configured cookie to %s', async (url) => {
    await expect(run(url, 'x', '12')).rejects.toThrow();
    expect(ofetch.raw).not.toHaveBeenCalled();
});
it('requires an operator origin binding for a configured cookie', async () => {
    config.discuz.origins = {};
    await expect(run('https://forum.test', 'x', '12')).rejects.toThrow();
    expect(ofetch.raw).not.toHaveBeenCalled();
});
it.each(['7', 'x'])('preserves authenticated %s listing and relative articles', async (version) => {
    vi.mocked(ofetch.raw)
        .mockResolvedValueOnce(response(html(version)))
        .mockResolvedValueOnce(response('<div id="postlist"><div id="post1"><table><tr><td id="postmessage1">Body</td></tr></table></div></div>'));
    const result = await run('https://forum.test/list', version, '12');
    expect(result.item).toHaveLength(1);
    expect(result.item[0].description).toBe('Body');
    expect(ofetch.raw).toHaveBeenLastCalledWith('https://forum.test/thread.html', expect.objectContaining({ headers: { Cookie: 'session=fake' } }));
});
it.each(['7', 'x'])('rejects off-origin %s article before cookie fetch', async (version) => {
    vi.mocked(ofetch.raw).mockResolvedValueOnce(response(html(version, '//evil.test/thread')));
    await expect(run('https://forum.test/list', version, '12')).rejects.toThrow();
    expect(ofetch.raw).toHaveBeenCalledTimes(1);
    expect(cache.tryGet).not.toHaveBeenCalled();
});
it('separates anonymous and authenticated article caches', async () => {
    await run();
    const anonKey = vi.mocked(cache.tryGet).mock.calls[0][0];
    await run('https://forum.test/list', 'x', '12');
    const authKey = vi.mocked(cache.tryGet).mock.calls[1][0];
    expect(authKey).not.toBe(anonKey);
    expect(authKey).not.toContain('session=fake');
    expect(anonKey).not.toBe('https://forum.test/thread.html');
});
it('follows only same-origin authenticated redirects', async () => {
    vi.mocked(ofetch.raw)
        .mockResolvedValueOnce(response('', 302, '/list/'))
        .mockResolvedValueOnce(response('<meta name="generator" content="DISCUZ! X">'));
    await run('https://forum.test/list', 'x', '12');
    expect(ofetch.raw).toHaveBeenLastCalledWith('https://forum.test/list/', expect.objectContaining({ redirect: 'manual' }));
});
it('rejects a redirect outside the credential origin', async () => {
    vi.mocked(ofetch.raw).mockResolvedValueOnce(response('', 302, 'https://evil.test/'));
    await expect(run('https://forum.test/list', 'x', '12')).rejects.toThrow();
    expect(ofetch.raw).toHaveBeenCalledTimes(1);
});

it('changes article cache identity after cookie rotation', async () => {
    await run('https://forum.test/list', 'x', '12');
    const first = vi.mocked(cache.tryGet).mock.calls[0][0];
    config.discuz.cookies['12'] = 'session=rotated';
    await run('https://forum.test/list', 'x', '12');
    expect(vi.mocked(cache.tryGet).mock.calls[1][0]).not.toBe(first);
});
it('blocks off-origin article redirects before forwarding cookies', async () => {
    vi.mocked(ofetch.raw)
        .mockResolvedValueOnce(response(html('X')))
        .mockResolvedValueOnce(response('', 302, 'https://evil.test/'));
    await expect(run('https://forum.test/list', 'x', '12')).rejects.toThrow();
    expect(ofetch.raw).toHaveBeenCalledTimes(2);
});
