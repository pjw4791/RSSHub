import { Route } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { load } from 'cheerio';
import iconv from 'iconv-lite';
import { parseDate } from '@/utils/parse-date';
import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import InvalidParameterError from '@/errors/types/invalid-parameter';
import md5 from '@/utils/md5';

function fixUrl(itemLink, baseUrl) {
    // 处理相对链接
    if (itemLink) {
        if (baseUrl && !/^https?:\/\//.test(baseUrl)) {
            baseUrl = /^\/\//.test(baseUrl) ? 'http:' + baseUrl : 'http://' + baseUrl;
        }
        itemLink = new URL(itemLink, baseUrl).href;
    }
    return itemLink;
}

function validateUrl(link: string, origin?: string) {
    const url = new URL(link);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (origin && (url.protocol !== 'https:' || url.origin !== origin))) {
        throw new InvalidParameterError('Discuz URL must match its configured credential origin');
    }
    return url.href;
}

async function fetchPage(link: string, header: { Cookie: string }, origin?: string) {
    let url = validateUrl(link, origin);
    for (let redirects = 0; redirects <= 5; redirects++) {
        // Validate each redirect before sending the credential again.
        // eslint-disable-next-line no-await-in-loop
        const response = await ofetch.raw(url, {
            method: 'get',
            responseType: 'arrayBuffer',
            headers: header,
            redirect: origin ? 'manual' : 'follow',
        });
        if (!origin || ![301, 302, 303, 307, 308].includes(response.status)) {
            return response;
        }
        const location = response.headers.get('location');
        if (!location) {
            throw new InvalidParameterError('Discuz redirect has no destination');
        }
        url = validateUrl(new URL(location, url).href, origin);
    }
    throw new InvalidParameterError('Too many Discuz redirects');
}

// discuz 7.x 与 discuz x系列 通用文章内容抓取
async function loadContent(itemLink, charset, header, origin?: string) {
    const response = await fetchPage(itemLink, header, origin);

    const responseData = iconv.decode(Buffer.from(response._data), charset ?? 'utf-8');
    if (!responseData) {
        const description = '获取详细内容失败';
        return { description };
    }

    const $ = load(responseData);

    const post = $('div#postlist div[id^=post] td[id^=postmessage]').first();

    // fix lazyload image
    post.find('img').each((_, img) => {
        img = $(img);
        if (img.attr('src')?.endsWith('none.gif') && img.attr('file')) {
            img.attr('src', img.attr('file') || img.attr('zoomfile'));
            img.removeAttr('file');
            img.removeAttr('zoomfile');
        }
    });

    // 只抓取论坛1楼消息
    const description = post.html();

    return { description };
}

export const route: Route = {
    path: ['/:ver{[7x]}/:cid{[0-9]{2}}/:link{.+}', '/:ver{[7x]}/:link{.+}', '/:link{.+}'],
    name: 'Unknown',
    maintainers: [],
    description: 'Requires ALLOW_USER_SUPPLY_UNSAFE_DOMAIN=true. Each DISCUZ_COOKIE_XX must have a matching DISCUZ_ORIGIN_XX HTTPS origin (for example https://forum.example). Authenticated requests and articles stay on that origin.',
    handler,
};

async function handler(ctx) {
    if (!config.feature.allow_user_supply_unsafe_domain) {
        throw new ConfigNotFoundError("This RSS is disabled unless 'ALLOW_USER_SUPPLY_UNSAFE_DOMAIN' is set to 'true'.");
    }
    let link = ctx.req.param('link');
    const ver = ctx.req.param('ver') ? ctx.req.param('ver').toUpperCase() : undefined;
    const cid = ctx.req.param('cid');
    link = link.replace(/:\/\//, ':/').replace(/:\//, '://');

    const cookie = cid === undefined ? '' : config.discuz.cookies[cid];
    if (cookie === undefined) {
        throw new ConfigNotFoundError('缺少对应论坛的cookie.');
    }

    let origin: string | undefined;
    if (cookie) {
        const binding = config.discuz.origins[cid];
        if (!binding) {
            throw new ConfigNotFoundError('Missing DISCUZ_ORIGIN for the selected cookie');
        }
        const configured = new URL(binding);
        if (configured.protocol !== 'https:' || configured.username || configured.password || configured.pathname !== '/' || configured.search || configured.hash) {
            throw new InvalidParameterError('DISCUZ_ORIGIN must be an HTTPS origin without credentials or path');
        }
        origin = configured.origin;
    }
    link = validateUrl(link, origin);
    const cacheScope = md5(JSON.stringify([origin ?? '', cookie]));
    const header = { Cookie: cookie };
    const response = await fetchPage(link, header, origin);

    const responseData = Buffer.from(response._data);
    // 若没有指定编码，则默认utf-8
    const contentType = response.headers['content-type'] || '';
    let $ = load(iconv.decode(responseData, 'utf-8'));
    const charset = contentType.match(/charset=([^;]*)/)?.[1] ?? $('meta[charset]').attr('charset') ?? $('meta[http-equiv="Content-Type"]').attr('content')?.split('charset=')?.[1];
    if (charset?.toLowerCase() !== 'utf-8') {
        $ = load(iconv.decode(responseData, charset ?? 'utf-8'));
    }

    const version = ver ? `DISCUZ! ${ver}` : $('head > meta[name=generator]').attr('content');

    let items;
    if (version.toUpperCase().startsWith('DISCUZ! 7')) {
        // discuz 7.x 系列
        // 支持全文抓取，限制抓取页面5个
        const list = $('tbody[id^="normalthread"] > tr')
            .slice(0, ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 5)
            .toArray()
            .map((item) => {
                item = $(item);
                const a = item.find('span[id^=thread] a');
                return {
                    title: a.text().trim(),
                    link: fixUrl(a.attr('href'), link),
                    pubDate: item.find('td.author em').length ? parseDate(item.find('td.author em').text().trim()) : undefined,
                    author: item.find('td.author cite a').text().trim(),
                };
            });

        for (const item of list) {
            validateUrl(item.link, origin);
        }
        items = await Promise.all(
            list.map((item) =>
                cache.tryGet(`discuz-origin-v2:${cacheScope}:${item.link}`, async () => {
                    const { description } = await loadContent(item.link, charset, header, origin);

                    item.description = description;
                    return item;
                })
            )
        );
    } else if (version.toUpperCase().startsWith('DISCUZ! X')) {
        // discuz X 系列
        // 支持全文抓取，限制抓取页面5个
        const list = $('tbody[id^="normalthread"] > tr')
            .slice(0, ctx.req.query('limit') ? Number.parseInt(ctx.req.query('limit'), 10) : 5)
            .toArray()
            .map((item) => {
                item = $(item);
                const a = item.find('a.xst');
                return {
                    title: a.text(),
                    link: fixUrl(a.attr('href'), link),
                    pubDate: item.find('td.by:nth-child(3) em span').last().length ? parseDate(item.find('td.by:nth-child(3) em span').last().text().trim()) : undefined,
                    author: item.find('td.by:nth-child(3) cite a').text().trim(),
                };
            });

        for (const item of list) {
            validateUrl(item.link, origin);
        }
        items = await Promise.all(
            list.map((item) =>
                cache.tryGet(`discuz-origin-v2:${cacheScope}:${item.link}`, async () => {
                    const { description } = await loadContent(item.link, charset, header, origin);

                    item.description = description;
                    return item;
                })
            )
        );
    } else {
        throw new InvalidParameterError('不支持当前Discuz版本.');
    }

    return {
        title: $('head > title').text(),
        description: $('head > meta[name=description]').attr('content'),
        link,
        item: items,
    };
}
