import { Route } from '@/types';
import parser from '@/utils/rss-parser';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { load } from 'cheerio';
import { parseDate } from '@/utils/parse-date';
import timezone from '@/utils/timezone';
import InvalidParameterError from '@/errors/types/invalid-parameter';

export const route: Route = {
    path: '/:lang?/:channel?',
    categories: ['traditional-media'],
    example: '/yna/en/national',
    parameters: {
        lang: 'Language, see below, `ko` by default',
        channel: 'RSS Feed Channel, see below, `news` by default',
    },
    features: {
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
        requireConfig: false,
    },
    name: 'News',
    maintainers: ['quiniapiezoelectricity'],
    handler,
    description: `
| Language  | 한국어 | English | 简体中文 | 日本語 | عربي   | Español | Français |
| --------- | ------ | ------- | -------- | ------ | ------ | ------- | -------- |
| \`:lang\` | \`ko\` | \`en\`  | \`cn\`   | \`jp\` | \`ar\` | \`es\`  | \`fr\`   |

For a full list of RSS Feed Channels, please refer to the RSS feed page of the corresponding language
| RSS Feed Page                                             |
| --------------------------------------------------------- |
| [한국어](https://www.yna.co.kr/rss/index?site=footer_rss) |
| [English](https://en.yna.co.kr/channel/index)             |
| [简体中文](https://cn.yna.co.kr/channel/index)            |
| [日本語](https://jp.yna.co.kr/channel/index)              |
| [عربي](https://ar.yna.co.kr/channel/index)                |
| [Español](https://sp.yna.co.kr/channel/index)             |
| [Français](https://fr.yna.co.kr/channel/index)            |

::: tip
For example, the path for the RSS feed url https://www.yna.co.kr/rss/economy.xml and https://cn.yna.co.kr/RSS/news.xml would be \`/ko/economy\` and \`/cn/news\` respectively. 
:::
`,
};

async function handler(ctx) {
    const lang = ctx.req.param('lang') ?? 'ko';
    const channel = ctx.req.param('channel') ?? 'news';
    const hosts = { ko: 'www', en: 'en', cn: 'cn', jp: 'jp', ar: 'ar', es: 'sp', fr: 'fr' };
    if (!Object.hasOwn(hosts, lang)) {
        throw new InvalidParameterError('Invalid YNA language');
    }
    const url = `https://${hosts[lang]}.yna.co.kr/${lang === 'ko' ? 'rss' : 'RSS'}/${channel}.xml`;
    const response = await got(url, { redirect: 'error' });
    const feed = await parser.parseString(response.body);
    for (const item of feed.items) {
        const articleUrl = new URL(item.link);
        if (!['http:', 'https:'].includes(articleUrl.protocol) || articleUrl.username || articleUrl.password || articleUrl.port || !Object.values(hosts).some((host) => articleUrl.hostname === `${host}.yna.co.kr`)) {
            throw new InvalidParameterError('YNA article URL must remain on an official HTTPS host');
        }
        articleUrl.protocol = 'https:';
        item.link = articleUrl.href;
    }
    const items = await Promise.all(
        feed.items.map((item) =>
            cache.tryGet(item.link, async () => {
                item.pubDate = lang === 'ko' ? parseDate(item.pubDate) : timezone(parseDate(item.pubDate), +9); // Timezone is only included in the pubDate of the Korean language RSS
                const response = await got(item.link, { redirect: 'error' });
                const $ = load(response.data);
                item.author =
                    item.creator ??
                    $('.tit-name')
                        .toArray()
                        .map((c) => $(c).text())
                        .join(', ');
                const article = $('article.story-news');
                article.find('.related-group').remove();
                article.find('.writer-zone01').remove();
                item.description = article.html();
                return item;
            })
        )
    );

    return {
        title: feed.title,
        link: feed.link,
        description: feed.description,
        language: feed.language ?? lang,
        item: items,
    };
}
