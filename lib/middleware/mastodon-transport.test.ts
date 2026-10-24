import { afterEach, expect, it, vi } from 'vitest';
import { config } from '@/config';
import { route as local } from '@/routes/mastodon/timeline-local';
import { route as remote } from '@/routes/mastodon/timeline-remote';
import got from '@/utils/got';

vi.mock('@/utils/got', () => ({ default: { get: vi.fn() } }));
const original = { ...config.mastodon };
afterEach(() => {
    Object.assign(config.mastodon, original);
    vi.clearAllMocks();
});
const context = (site: string) => ({ req: { param: (key: string) => (key === 'site' ? site : 'true') } });
it.each([
    [local, 'local'],
    [remote, 'remote'],
])('uses HTTPS and forbids authenticated redirects for %s', async (route, mode) => {
    config.mastodon.apiHost = 'mastodon.social';
    config.mastodon.accessToken = 'fake-token';
    vi.mocked(got.get).mockResolvedValue({ data: [] });
    await (route.handler as (ctx: unknown) => Promise<unknown>)(context('mastodon.social'));
    expect(got.get).toHaveBeenLastCalledWith(`https://mastodon.social/api/v1/timelines/public?${mode}=true&only_media=true`, expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' }, redirect: 'error' }));
    await (route.handler as (ctx: unknown) => Promise<unknown>)(context('pawoo.net'));
    expect(got.get).toHaveBeenLastCalledWith(`https://pawoo.net/api/v1/timelines/public?${mode}=true&only_media=true`, expect.objectContaining({ headers: {} }));
});
