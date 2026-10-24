import { afterEach, expect, it, vi } from 'vitest';
import { config } from '@/config';
import { route } from '@/routes/misskey/home-timeline';
import javdb from '@/routes/javdb/utils';
import got from '@/utils/got';

vi.mock('@/utils/got', () => ({ default: vi.fn() }));
const original = { misskey: { ...config.misskey }, javdb: { ...config.javdb }, unsafe: config.feature.allow_user_supply_unsafe_domain };
afterEach(() => {
    Object.assign(config.misskey, original.misskey);
    Object.assign(config.javdb, original.javdb);
    config.feature.allow_user_supply_unsafe_domain = original.unsafe;
    vi.clearAllMocks();
});
const context = (site: string) => ({ req: { param: (key: string) => (key === 'site' ? site : ''), query: (key: string) => (key === 'domain' ? site : undefined) } });
it.each(['evil.test', 'misskey.io@evil.test', 'misskey.io:8443', 'misskey.io/path'])('does not send Misskey credentials to %s', async (site) => {
    config.feature.allow_user_supply_unsafe_domain = true;
    config.misskey.accessToken = 'fake-token';
    config.misskey.apiHost = 'misskey.io';
    await expect((route.handler as (ctx: unknown) => Promise<unknown>)(context(site))).rejects.toThrow();
    expect(got).not.toHaveBeenCalled();
});
it('sends Misskey credentials only to configured HTTPS origin without redirects', async () => {
    config.misskey.accessToken = 'fake-token';
    config.misskey.apiHost = 'misskey.io';
    vi.mocked(got).mockResolvedValue({ data: [] });
    await (route.handler as (ctx: unknown) => Promise<unknown>)(context('misskey.io'));
    expect(got).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://misskey.io/api/notes/timeline', redirect: 'error', headers: { Authorization: 'Bearer fake-token' } }));
});
it.each(['evil.test', 'javdb36.com'])('does not attach JavDB session to another domain %s', async (site) => {
    config.feature.allow_user_supply_unsafe_domain = true;
    config.javdb.session = 'fake-cookie';
    config.javdb.sessionDomain = 'javdb.com';
    vi.mocked(got).mockResolvedValue({ data: '<html></html>' });
    await javdb.ProcessItems(context(site), '/', 'test');
    const options = vi.mocked(got).mock.calls[0][0];
    expect(options.cookieJar.getCookieStringSync(`https://${site}`)).toBe('');
});
it('keeps JavDB cookie on the configured host and disables redirects', async () => {
    config.javdb.session = 'fake-cookie';
    config.javdb.sessionDomain = 'javdb.com';
    vi.mocked(got).mockResolvedValue({ data: '<html></html>' });
    await javdb.ProcessItems(context('javdb.com'), '/', 'test');
    const options = vi.mocked(got).mock.calls[0][0];
    expect(options.cookieJar.getCookieStringSync('https://javdb.com')).toContain('fake-cookie');
    expect(options.redirect).toBe('error');
});
