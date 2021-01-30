import EventManager from 'event-manager';
import {proxySelector, proxySelectorAll} from 'proxy-element';
import {route, Router} from 'router';
import {importScript, importStyle, importResource} from 'import-resource';
import {factory as createElement} from 'create-element';
import buildConfig from './lib/buildConfig';
import withNestedNS from './lib/withNestedNS';
import replaceContent from './lib/replaceContent';

const create = (config = {}) => {
    config = buildConfig(config);

    const mediator = new EventManager();
    const router = new Router({baseRoute: config.baseRoute});

    return {
        addEventListener: (e, f) => mediator.addListener(e, f),
        addRouteListener: (r, f) => router.addListener(r, f),
        config,
        createElement: createElement(withNestedNS(config, 'element')),
        dispatchEvent: (e, p) => mediator.dispatch(e, p),
        dispatchRoute: path => router.dispatch(path),
        importResource,
        importScript,
        importStyle,
        proxySelector,
        proxySelectorAll,
        removeEventListener: (e, f) => mediator.removeListener(e, f),
        removeRouteListener: (r, f) => router.removeListener(r, f),
        replaceContent,
        route,
        Router,
    };
};

export default {create, ...create()};
