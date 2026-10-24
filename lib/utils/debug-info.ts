type DebugInfo = {
    hitCache: number;
    request: number;
    etag: number;
    error: number;
    routes: Record<string, number>;
    errorRoutes: Record<string, number>;
};

const debug: DebugInfo = {
    hitCache: 0,
    request: 0,
    etag: 0,
    error: 0,
    routes: {},
    errorRoutes: {},
};

export const getDebugInfo = () => debug;
export const setDebugInfo = (info: typeof debug) => Object.assign(debug, info);
