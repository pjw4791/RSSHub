import { Route } from '@/types';
import cache from '@/utils/cache';
import got from '@/utils/got';
import { config } from '@/config';
import ConfigNotFoundError from '@/errors/types/config-not-found';
import md5 from '@/utils/md5';

const isToday = (date) => {
    date = new Date(date);
    const today = new Date();
    return date.getDate() === today.getDate() && date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear();
};

const ProcessFeed = async () => {
    const device_id = config.xiaoyuzhou.device_id;
    const tokenCacheKey = `XIAOYUZHOU_TOKEN_${md5(config.xiaoyuzhou.refresh_token!)}`;
    const refresh_token = (await cache.get(tokenCacheKey)) || config.xiaoyuzhou.refresh_token;

    const headers = {
        applicationid: 'app.podcast.cosmos',
        'app-version': '1.6.0',
        'x-jike-device-id': device_id,
        'user-agent': 'okhttp/4.7.2',
    };

    const token_updated = await got({
        method: 'post',
        url: 'https://api.xiaoyuzhoufm.com/app_auth_tokens.refresh',
        headers: {
            ...headers,
            'x-jike-refresh-token': refresh_token,
        },
    });
    cache.set(tokenCacheKey, token_updated.data['x-jike-refresh-token']);

    const response = await got({
        method: 'post',
        url: 'https://api.xiaoyuzhoufm.com/v1/editor-pick/list',
        headers: {
            ...headers,
            'x-jike-access-token': token_updated.data['x-jike-access-token'],
        },
    });

    const data = response.data.data;
    const playList = [];
    for (const dailyPicks of data) {
        const pubDate = new Date(dailyPicks.date + ' 00:00:00 +0800').toUTCString();
        for (const pick of dailyPicks.picks) {
            pick.pubDate = pubDate;
            playList.push(pick);
        }
    }

    return playList.map((item) => {
        const title = item.episode.title + ' - ' + item.episode.podcast.title;
        const eid = item.episode.eid;
        const itunes_item_image = item.episode.image ? item.episode.image.picUrl : (item.episode.podcast.image ? item.episode.podcast.image.picUrl : '');
        const link = `https://www.xiaoyuzhoufm.com/episode/${eid}`;
        const pubDate = item.pubDate;
        const itunes_duration = item.episode.duration;
        const enclosure_url = item.episode.enclosure.url;
        const desc = `<p><strong>${item.comment.author.nickname}：</strong>${item.comment.text}</p><hr>` + item.episode.shownotes;
        const author = item.episode.podcast.author;

        return {
            title,
            description: desc,
            link,
            author,
            pubDate,
            enclosure_url,
            itunes_duration,
            itunes_item_image,
            enclosure_type: 'audio/mpeg',
        };
    });
};

export const route: Route = {
    path: '/',
    radar: [
        {
            source: ['xiaoyuzhoufm.com/'],
            target: '',
        },
    ],
    name: 'Unknown',
    maintainers: ['prnake', 'Maecenas'],
    handler,
    url: 'xiaoyuzhoufm.com/',
};

async function handler() {
    if (!config.xiaoyuzhou.device_id || !config.xiaoyuzhou.refresh_token) {
        throw new ConfigNotFoundError('XIAOYUZHOU_ID and XIAOYUZHOU_TOKEN are required');
    }
    const itemsCacheKey = `xiaoyuzhou_items_${md5(config.xiaoyuzhou.refresh_token)}`;
    let resultItems = await cache.tryGet(itemsCacheKey, () => ProcessFeed());
    if (!isToday(resultItems[0].pubDate)) {
        // force refresh cache
        resultItems = await ProcessFeed();
        cache.set(itemsCacheKey, resultItems);
    }
    return {
        title: '小宇宙 - 发现',
        link: 'https://www.xiaoyuzhoufm.com/',
        description: '小宇宙的编辑精选',
        image: 'https://www.xiaoyuzhoufm.com/apple-touch-icon.png',
        itunes_author: '小宇宙',
        itunes_category: 'Society & Culture',
        item: resultItems,
    };
}
