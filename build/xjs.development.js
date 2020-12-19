var xjs = (function () {
    'use strict';

    class EventManager {
        constructor(props = {}) {
            this.shouldCallListener = props.shouldCallListener ?
                props.shouldCallListener.bind(this) :
                ((listener, event) => listener.type === '*' || listener.type === event.type);

            this.toHandlerPayload = props.toHandlerPayload ?
                props.toHandlerPayload.bind(this) :
                ((listener, event) => event);

            this.listeners = [];
        }
        addEventListener(type, handler) {
            if (Array.isArray(handler))
                return handler.map(h => this.addEventListener(type, h));

            if (typeof handler !== 'function')
                return;

            const id = Math.random().toString(36).slice(2);
            this.listeners.push({type, handler, id});

            return {
                remove: () => {
                    for (let i = this.listeners.length - 1; i >= 0; i--) {
                        if (this.listeners[i].id === id)
                            this.listeners.splice(i, 1);
                    }
                }
            };
        }
        removeEventListener(type, handler) {
            if (Array.isArray(handler))
                return handler.map(h => this.removeEventListener(type, h));

            for (let i = this.listeners.length - 1; i >= 0; i--) {
                let L = this.listeners[i];
                if (L.type === type && (!handler || L.handler === handler))
                    this.listeners.splice(i, 1);
            }
        }
        dispatchEvent(type, props) {
            const event = {...props, type};

            for (let i = 0, n = this.listeners.length; i < n; i++) {
                let L = this.listeners[i];
                if (this.shouldCallListener(L, event))
                    L.handler(this.toHandlerPayload(L, event));
            }
        }
    }

    class ProxyElement {
        constructor(host, selector, all = false) {
            if (typeof host === 'string') {
                this.host = document;
                this.selector = host;
            }
            else if (host instanceof ProxyElement) {
                this.host = host.host;
                this.selector = host.selector + ' ' + (selector || '');
            }
            else {
                this.host = host || document;
                this.selector = selector;
            }

            this.selector = String(this.selector || '').trim();
            this.all = all;
            this.listeners = [];
        }
        proxySelector(selector) {
            return new ProxyElement(this, selector);
        }
        proxySelectorAll(selector) {
            return new ProxyElement(this, selector, true);
        }
        addEventListener(type, handler, useCapture = false) {
            let {host, selector, all, listeners} = this;

            let proxyHandler = event => {
                if (!selector)
                    handler.call(host, event);
                else if (all) {
                    for (let t = event.target; t; t = t.parentNode) {
                        if (typeof t.matches === 'function' && t.matches(selector)) {
                            handler.call(t, event);
                            break;
                        }
                    }
                }
                else {
                    let e = host.querySelector(selector);
                    for (let t = event.target; e && t; t = t.parentNode) {
                        if (t === e) {
                            handler.call(t, event);
                            break;
                        }
                    }
                }
            };

            host.addEventListener(type, proxyHandler, useCapture);
            listeners.push({type, handler, useCapture, proxyHandler});
        }
        removeEventListener(type, handler, useCapture = false) {
            let {host, listeners} = this;

            for (let i = listeners.length - 1; i >= 0; i--) {
                let L = listeners[i];

                if (L.type === type && L.handler === handler && L.useCapture === useCapture) {
                    host.removeEventListener(type, L.proxyHandler, useCapture);
                    listeners.splice(i, 1);
                }
            }
        }
        getHost() {
            return this.host;
        }
        query() {
            let {host, selector, all} = this;

            if (!host)
                return;

            if (!selector)
                return host;

            return all ?
                host.querySelectorAll(selector) :
                host.querySelector(selector);
        }
    }

    var proxySelector = (selector, host) => new ProxyElement(host, selector, false);

    var proxySelectorAll = (selector, host) => new ProxyElement(host, selector, true);

    var getFullPath = x => {
        try {
            let url;

            if (x === null || x === undefined)
                url = new URL(window.location.href);
            else if (x.href !== undefined)
                url = new URL(x.href);
            else
                url = new URL(x, window.location.origin);

            let {pathname, search, hash} = url;
            return pathname + search + hash;
        }
        catch(e) {}
    };

    var isNavigable = element => {
        if (!element || element.href === undefined)
            return false;

        try {
            return new URL(element.href).origin === window.location.origin;
        }
        catch(e) {}
    };

    var isCollection = x => Array.isArray(x) || x instanceof NodeList || x instanceof HTMLCollection;

    var Event = {
        ROUTE_CHANGE: 'ROUTE_CHANGE',
    };

    class Route {
        constructor() {
            this.eventManager = new EventManager();
            this.subscriptions = [];

            window.addEventListener('popstate', () => this.dispatchRoute());
        }
        dispatchRoute(path) {
            this.eventManager.dispatchEvent(Event.ROUTE_CHANGE, {
                path: path === undefined ? getFullPath() : path,
            });
        }
        subscribe(target) {
            let handler;

            if (!target)
                return;

            // array-like collection
            else if (isCollection(target)) {
                for (let t of target) this.subscribe(t);
            }

            // selector
            else if (typeof target === 'string')
                document.addEventListener('click', handler = event => {
                    for (let t = event.target; t; t = t.parentNode) {
                        if (t.matches && t.matches(target) && isNavigable(t)) {
                            event.preventDefault();
                            this.assign(getFullPath(t));
                        }
                    }
                });

            else if (target instanceof HTMLElement)
                target.addEventListener('click', handler = event => {
                    if (isNavigable(target)) {
                        event.preventDefault();
                        this.assign(getFullPath(target));
                    }
                });

            // Router
            else if (target.dispatchRoute)
                this.eventManager.addEventListener(Event.ROUTE_CHANGE, handler = event => {
                    target.dispatchRoute(event.path);
                });

            if (handler)
                this.subscriptions.push({target, handler});
        }
        unsubscribe(target) {
            if (!target)
                return;

            if (isCollection(target)) {
                for (let t of target) this.unsubscribe(t);
                return;
            }

            for (let i = this.subscriptions.length - 1; i >= 0; i--) {
                let {target: t, handler: f} = this.subscriptions[i];

                if (t !== target)
                    continue;

                if (typeof t === 'string')
                    document.removeEventListener('click', f);

                else if (t instanceof HTMLElement)
                    t.removeEventListener('click', f);

                else if (t.dispatchRoute)
                    this.eventManager.removeEventListener(Event.ROUTE_CHANGE, f);

                this.subscriptions.splice(i, 1);
            }
        }
        assign(path) {
            history.pushState({}, '', path);
            this.dispatchRoute();
        }
        replace(path) {
            history.replaceState({}, '', path);
            this.dispatchRoute();
        }
        reload() {
            this.dispatchRoute();
        }
        toString() {
            return getFullPath();
        }
        go(delta) {
            history.go(delta);
        }
        back() {
            this.go(-1);
        }
        forward() {
            this.go(1);
        }
    }

    var route = new Route();

    class Router {
        constructor(props = {}) {
            this.setBaseRoute(props.baseRoute);

            this.eventManager = new EventManager({
                shouldCallListener: (listener, event) => {
                    if (!this.matchesBaseRoute(event.type))
                        return false;

                    let routePattern = listener.type;
                    let path = this.truncateBaseRoute(event.type);

                    if (props.shouldCallListener)
                        return props.shouldCallListener.call(this, routePattern, path);

                    return routePattern instanceof RegExp ?
                        routePattern.test(path) :
                        routePattern === path;
                },
                toHandlerPayload: (listener, event) => {
                    let routePattern = listener.type;
                    let path = this.truncateBaseRoute(event.type);

                    if (props.toHandlerPayload)
                        return props.toHandlerPayload.call(this, routePattern, path);

                    let params = routePattern instanceof RegExp ?
                        path.match(routePattern) || [] :
                        [];

                    return {params, path};
                },
            });

            route.subscribe(this);
        }
        setBaseRoute(baseRoute) {
            this.baseRoute = (baseRoute || '').replace(/\/$/, '');
        }
        matchesBaseRoute(path) {
            const {baseRoute} = this;

            return !baseRoute || path === baseRoute ||
                (path && ['/', '?', '#'].some(c => path.startsWith(baseRoute + c)));
        }
        truncateBaseRoute(path) {
            const {baseRoute} = this;

            if (!path || !baseRoute || !path.startsWith(baseRoute))
                return path;

            return path.slice(baseRoute.length);
        }
        addRouteListener(routePattern, handler) {
            return this.eventManager.addEventListener(routePattern, handler);
        }
        removeRouteListener(routePattern, handler) {
            return this.eventManager.removeEventListener(routePattern, handler);
        }
        dispatchRoute(path) {
            return this.eventManager.dispatchEvent(path === undefined ? getFullPath() : path);
        }
    }

    const cache = {};

    var importResource = async (tagName, attrs, targetNode) => {
        let attrEntries = Object.entries(attrs);
        let selector = `${tagName}${attrEntries.map(([k, v]) => `[${k}="${v}"]`).join('')}`;
        let e = document.querySelector(selector);

        if (e)
            return Promise.resolve(e);

        if (cache[selector])
            return cache[selector];

        return (cache[selector] = new Promise((resolve, reject) => {
            let e = document.createElement(tagName);

            e.addEventListener('load', () => {
                delete cache[selector];
                resolve(e);
            });

            e.addEventListener('error', () => {
                delete cache[selector];
                reject(e);
            });

            for (let [k, v] of attrEntries)
                e.setAttribute(k, v);

            (targetNode || document.head).appendChild(e);
        }));
    };

    var importScript = async (src, attrs) => {
        return await importResource('script', {...attrs, src});
    };

    var importStyle = async (href, attrs) => {
        return await importResource('link', {rel: 'stylesheet', ...attrs, href});
    };

    class MemoryStorage {
        constructor(capacity) {
            this._storage = Object.create(null);
            this._keys = [];
            this.setCapacity(capacity);
        }
        setCapacity(capacity) {
            this.capacity = typeof capacity === 'number' ? capacity : Infinity;
            this.revise();
        }
        revise() {
            while (this._keys.length > Math.max(this.capacity, 0))
                this.removeItem(this._keys[0]);
        }
        getItem(key) {
            return this._storage[key];
        }
        setItem(key, value) {
            this._keys.push(key);
            this._storage[key] = value;
            this.revise();
        }
        removeItem(key) {
            let k = this._keys.indexOf(key);

            if (k !== -1) {
                delete this._storage[key];
                this._keys.splice(k, 1);
            }
        }
        clear() {
            this._storage = Object.create(null);
            this._keys = [];
        }
        key(index) {
            return this._keys[index];
        }
        keys() {
            return this._keys.slice();
        }
        length() {
            return this._keys.length;
        }
        iterate(callback) {
            this._keys.forEach((key, index) => callback(this._storage[key], key, index));
        }
    }

    var memoryStorage = MemoryStorage;

    class VolatileStorage {
        constructor(props = {}) {
            this.storage = props.storage || new memoryStorage();
            this.ns = props.ns ? props.ns + '.' : '';
            this.version = props.version;

            this.setCapacity(props.capacity);
            this.setMaxAge(props.maxAge);
            this.scheduleRevision();
        }
        setCapacity(capacity) {
            this.capacity = typeof capacity === 'number' ? capacity : Infinity;
            this.scheduleRevision();
        }
        setMaxAge(maxAge) {
            this.maxAge = typeof maxAge === 'number' ? maxAge : Infinity;
            this.scheduleRevision();
        }
        hasValidContent(item) {
            return (
                Boolean(item) &&
                item.t + this.maxAge > Date.now() &&
                item.v === this.version
            );
        }
        async getItem(key) {
            let item;

            try {
                let storedValue = await this.storage.getItem(this.ns + key);
                item = JSON.parse(storedValue);
            }
            catch(e) {}

            if (this.hasValidContent(item)) return item.x;
            else if (item) this.removeItem(key);
        }
        async setItem(key, value, options) {
            let item = {x: value, t: Date.now(), v: this.version};

            await this.storage.setItem(this.ns + key, JSON.stringify(item));
            this.scheduleRevision();
        }
        async removeItem(key) {
            await this.storage.removeItem(this.ns + key);
        }
        async key(index) {
            return await this.storage.key(index);
        }
        async clear() {
            await this.storage.clear();
        }
        async keys() {
            let {storage, ns} = this, keys;

            if (typeof storage.keys === 'function')
                keys = await storage.keys();
            else {
                keys = [];

                let size = typeof storage.length === 'function' ?
                    await storage.length() :
                    storage.length;

                for (let i = 0; i < size; i++)
                    keys.push(await storage.key(i));
            }

            if (ns) {
                keys = keys
                    .filter(key => key && key.startsWith(ns))
                    .map(key => key.slice(ns.length));
            }

            return keys;
        }
        async revise() {
            let keys = await this.keys();
            let overflow = keys.length - this.capacity;

            return Promise.all(
                keys.map(async (key, i) => {
                    if (i < overflow) await this.removeItem(key);
                    // getItem() on expired items will remove them
                    else await this.getItem(key);
                })
            );
        }
        scheduleRevision() {
            clearTimeout(this._revisionTimeout);
            this._revisionTimeout = setTimeout(() => this.revise(), 50);
        }
    }

    var volatileStorage = VolatileStorage;

    // <meta name="ns.prop" content="xxx">
    var getMeta = (name, ns) => {
        if (!name)
            return;

        let meta = document.querySelector(`meta[name="${(ns ? ns + '.' : '') + name}"`);
        
        if (meta)
            return meta.content;
    };

    // <html data-ns-prop="xxx">
    var getRootDataAttribute = (name, ns) => {
        if (!name)
            return;

        let attrNames = ns ? [
            // sampleProp > data-ns-sample-prop > dataset.nsSampleProp
            ns + name[0].toUpperCase() + name.slice(1),
            // sampleProp > data-ns-sampleProp > dataset.nsSampleprop
            ns + name[0].toUpperCase() + name.slice(1).toLowerCase(),
        ] : [
            // sampleProp > data-sample-prop > dataset.sampleProp
            name,
            // sampleProp > data-sampleProp > dataset.sampleprop
            name.toLowerCase(),
        ];

        return attrNames
            .map(attr => document.documentElement.dataset[attr])
            .find(x => x !== undefined);
    };

    var getDocumentConfig = (options = {}) => {
        let {ns, props, transform = {}} = options;
        let applyTransform = (k, v) => typeof transform[k] === 'function' ? transform[k](v) : v;
        let config = Object.create(null);

        if (Array.isArray(props)) {
            for (let k of props) {
                let value = [getMeta(k, ns), getRootDataAttribute(k, ns)]
                    .find(x => x !== undefined);

                if (value !== undefined)
                    config[k] = applyTransform(k, value);
            }
        }
        else if (ns) {
            for (let [k, v] of Object.entries(document.documentElement.dataset)) {
                // k = <ns><uppercase character><rest>
                let matchesNS = (
                    k.startsWith(ns) &&
                    k[ns.length] &&
                    k[ns.length] === k[ns.length].toUpperCase()
                );

                if (matchesNS) {
                    let key = k.slice(ns.length);

                    if (key) {
                        key = key[0].toLowerCase() + key.slice(1);

                        config[key] = applyTransform(key, v);
                    }
                }
            }

            for (let meta of document.querySelectorAll(`meta[name^="${ns}."]`)) {
                let key = meta.name.slice(ns.length + 1);

                if (key)
                    config[key] = applyTransform(key, meta.content);
            }
        }
        
        return config;
    };

    var escapeStringRegexp = string => {
    	if (typeof string !== 'string') {
    		throw new TypeError('Expected a string');
    	}

    	// Escape characters with special meaning either inside or outside character sets.
    	// Use a simple backslash escape when it’s always valid, and a \unnnn escape when the simpler form would be disallowed by Unicode patterns’ stricter grammar.
    	return string
    		.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
    		.replace(/-/g, '\\x2d');
    };

    /*!
     * escape-html
     * Copyright(c) 2012-2013 TJ Holowaychuk
     * Copyright(c) 2015 Andreas Lubbe
     * Copyright(c) 2015 Tiancheng "Timothy" Gu
     * MIT Licensed
     */

    /**
     * Module variables.
     * @private
     */

    var matchHtmlRegExp = /["'&<>]/;

    /**
     * Module exports.
     * @public
     */

    var escapeHtml_1 = escapeHtml;

    /**
     * Escape special characters in the given string of html.
     *
     * @param  {string} string The string to escape for inserting into HTML
     * @return {string}
     * @public
     */

    function escapeHtml(string) {
      var str = '' + string;
      var match = matchHtmlRegExp.exec(str);

      if (!match) {
        return str;
      }

      var escape;
      var html = '';
      var index = 0;
      var lastIndex = 0;

      for (index = match.index; index < str.length; index++) {
        switch (str.charCodeAt(index)) {
          case 34: // "
            escape = '&quot;';
            break;
          case 38: // &
            escape = '&amp;';
            break;
          case 39: // '
            escape = '&#39;';
            break;
          case 60: // <
            escape = '&lt;';
            break;
          case 62: // >
            escape = '&gt;';
            break;
          default:
            continue;
        }

        if (lastIndex !== index) {
          html += str.substring(lastIndex, index);
        }

        lastIndex = index + 1;
        html += escape;
      }

      return lastIndex !== index
        ? html + str.substring(lastIndex, index)
        : html;
    }

    var compile = (s, data = {}) => {
        if (!s) return s;

        if (window.Handlebars)
            return window.Handlebars.compile(s)(data);

        for (let [k, v] of Object.entries(data))
            s = s.replace(
                new RegExp(`\\$\\{${escapeStringRegexp(String(k))}\\}`, 'g'),
                escapeHtml_1(v),
            );

        return s;
    };

    const props = [
        'endpoint',
        'templateContainer',
        'cacheMaxAge',
        'cacheStorage',
        'cacheNamespace',
        'cacheCapacity',
        'version',
    ];

    const transform = {
        cacheMaxAge: Number,
        cacheCapacity: Number,
        cacheStorage: x => window[x],
    };

    var buildConfig = (config = {}) => {
        const {ns} = config;

        return {
            compile,
            templateContainer: 'template',
            cacheNamespace: ns,
            ...getDocumentConfig({ns, props, transform}),
            ...config,
        };
    };

    async function resolve(response) {
        let {ok, headers, status, statusText} = response;
        let output = {status, statusText, headers};

        if (ok) {
            output.data = await response.text();
            return output;
        }
        else throw new Error(output);
    }

    var createAPIClient = ({ baseURL }) => {
        return {
            get: async path => {
                let response = await fetch(baseURL + path);

                return await resolve(response);
            },
            post: async (path, options = {}) => {
                let response = await fetch(baseURL + path, {
                    method: 'POST',
                    body: JSON.stringify(options.data || {}),
                    headers: {
                        'Content-Type': 'application/json',
                    },
                });

                return await resolve(response);
            },
        };
    };

    var createElement = config => {
        const {
            endpoint,
            templateContainer,
            compile,
            onError,
            cacheMaxAge,
            cacheCapacity,
            cacheStorage,
            cacheNamespace,
            version,
        } = buildConfig(config);

        let api, cache;

        if (endpoint) {
            cache = new volatileStorage({
                maxAge: cacheMaxAge,
                capacity: cacheCapacity,
                storage: cacheStorage,
                ns: cacheNamespace,
                version,
            });

            api = createAPIClient({
                baseURL: endpoint,
            });
        }

        return async (elementName, data, serverSideTemplateRendering = false) => {
            let innerHTML;

            if (serverSideTemplateRendering && api) {
                try {
                    let response = await api.post(elementName, {data});
                    innerHTML = response.data;
                }
                catch(e) {
                    if (onError) onError(e);
                }
            }
            else {
                let s, tmplElement = document.querySelector(
                    `${templateContainer}[data-element="${elementName}"]`
                );

                if (tmplElement)
                    s = tmplElement.innerHTML;
                else if (api) {
                    s = await cache.getItem(elementName);

                    if (!s) {
                        try {
                            let response = await api.get(elementName);
                            await cache.setItem(elementName, s = response.data);
                        }
                        catch(e) {
                            if (onError) onError(e);
                        }
                    }
                }

                innerHTML = compile(s, data);
            }

            let fragment = document.createDocumentFragment();

            if (innerHTML) {
                let buffer = Object.assign(document.createElement('body'), {innerHTML});

                while (buffer.childNodes.length)
                    fragment.appendChild(buffer.firstChild);
            }

            return fragment;
        };
    };

    const createElement$1 = createElement();

    const DEFAULT_NS = 'xjs';
    const props$1 = ['baseRoute'];

    var buildConfig$1 = (config = {}) => {
        const {ns = DEFAULT_NS} = config;

        return {
            ns,
            ...getDocumentConfig({ns, props: props$1}),
            ...config,
        };
    };

    var withNestedNS = (config, subNS) => {
        const ns = config && config.ns;

        return {
            ...config,
            ns: (ns ? ns + '.' : '') + subNS,
        };
    };

    var replaceContent = (element, content) => {
        if (typeof content === 'string')
            element.innerHTML = content;
        else {
            element.innerHTML = '';
            if (content) element.appendChild(content);
        }

        return element;
    };

    const create = (config = {}) => {
        config = buildConfig$1(config);

        const mediator = new EventManager();
        const router = new Router({baseRoute: config.baseRoute});

        return {
            addEventListener: (e, f) => mediator.addEventListener(e, f),
            addRouteListener: (r, f) => router.addRouteListener(r, f),
            config,
            createElement: createElement(withNestedNS(config, 'element')),
            dispatchEvent: (e, p) => mediator.dispatchEvent(e, p),
            dispatchRoute: path => router.dispatchRoute(path),
            importResource,
            importScript,
            importStyle,
            proxySelector,
            proxySelectorAll,
            removeEventListener: (e, f) => mediator.removeEventListener(e, f),
            removeRouteListener: (r, f) => router.removeRouteListener(r, f),
            replaceContent,
            route,
            Router,
        };
    };

    var index = {create, ...create()};

    return index;

}());
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoieGpzLmRldmVsb3BtZW50LmpzIiwic291cmNlcyI6WyIuLi9ub2RlX21vZHVsZXMvZXZlbnQtbWFuYWdlci9pbmRleC5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcm94eS1lbGVtZW50L3NyYy9Qcm94eUVsZW1lbnQuanMiLCIuLi9ub2RlX21vZHVsZXMvcHJveHktZWxlbWVudC9zcmMvcHJveHlTZWxlY3Rvci5qcyIsIi4uL25vZGVfbW9kdWxlcy9wcm94eS1lbGVtZW50L3NyYy9wcm94eVNlbGVjdG9yQWxsLmpzIiwiLi4vbm9kZV9tb2R1bGVzL3JvdXRlci9saWIvZ2V0RnVsbFBhdGguanMiLCIuLi9ub2RlX21vZHVsZXMvcm91dGVyL2xpYi9pc05hdmlnYWJsZS5qcyIsIi4uL25vZGVfbW9kdWxlcy9yb3V0ZXIvbGliL2lzQ29sbGVjdGlvbi5qcyIsIi4uL25vZGVfbW9kdWxlcy9yb3V0ZXIvbGliL0V2ZW50LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3JvdXRlci9zcmMvcm91dGUuanMiLCIuLi9ub2RlX21vZHVsZXMvcm91dGVyL3NyYy9Sb3V0ZXIuanMiLCIuLi9ub2RlX21vZHVsZXMvaW1wb3J0LXJlc291cmNlL3NyYy9pbXBvcnRSZXNvdXJjZS5qcyIsIi4uL25vZGVfbW9kdWxlcy9pbXBvcnQtcmVzb3VyY2Uvc3JjL2ltcG9ydFNjcmlwdC5qcyIsIi4uL25vZGVfbW9kdWxlcy9pbXBvcnQtcmVzb3VyY2Uvc3JjL2ltcG9ydFN0eWxlLmpzIiwiLi4vbm9kZV9tb2R1bGVzL21lbW9yeS1zdG9yYWdlL2luZGV4LmpzIiwiLi4vbm9kZV9tb2R1bGVzL3ZvbGF0aWxlLXN0b3JhZ2UvaW5kZXguanMiLCIuLi9ub2RlX21vZHVsZXMvZG9jdW1lbnQtY29uZmlnL2xpYi9nZXRNZXRhLmpzIiwiLi4vbm9kZV9tb2R1bGVzL2RvY3VtZW50LWNvbmZpZy9saWIvZ2V0Um9vdERhdGFBdHRyaWJ1dGUuanMiLCIuLi9ub2RlX21vZHVsZXMvZG9jdW1lbnQtY29uZmlnL3NyYy9nZXREb2N1bWVudENvbmZpZy5qcyIsIi4uL25vZGVfbW9kdWxlcy9lc2NhcGUtc3RyaW5nLXJlZ2V4cC9pbmRleC5qcyIsIi4uL25vZGVfbW9kdWxlcy9lc2NhcGUtaHRtbC9pbmRleC5qcyIsIi4uL25vZGVfbW9kdWxlcy9jcmVhdGUtZWxlbWVudC9saWIvY29tcGlsZS5qcyIsIi4uL25vZGVfbW9kdWxlcy9jcmVhdGUtZWxlbWVudC9saWIvYnVpbGRDb25maWcuanMiLCIuLi9ub2RlX21vZHVsZXMvY3JlYXRlLWVsZW1lbnQvbGliL2NyZWF0ZUFQSUNsaWVudC5qcyIsIi4uL25vZGVfbW9kdWxlcy9jcmVhdGUtZWxlbWVudC9zcmMvY3JlYXRlRWxlbWVudC5qcyIsIi4uL25vZGVfbW9kdWxlcy9jcmVhdGUtZWxlbWVudC9pbmRleC5qcyIsIi4uL2xpYi9idWlsZENvbmZpZy5qcyIsIi4uL2xpYi93aXRoTmVzdGVkTlMuanMiLCIuLi9saWIvcmVwbGFjZUNvbnRlbnQuanMiLCIuLi9pbmRleC5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyJjbGFzcyBFdmVudE1hbmFnZXIge1xyXG4gICAgY29uc3RydWN0b3IocHJvcHMgPSB7fSkge1xyXG4gICAgICAgIHRoaXMuc2hvdWxkQ2FsbExpc3RlbmVyID0gcHJvcHMuc2hvdWxkQ2FsbExpc3RlbmVyID9cclxuICAgICAgICAgICAgcHJvcHMuc2hvdWxkQ2FsbExpc3RlbmVyLmJpbmQodGhpcykgOlxyXG4gICAgICAgICAgICAoKGxpc3RlbmVyLCBldmVudCkgPT4gbGlzdGVuZXIudHlwZSA9PT0gJyonIHx8IGxpc3RlbmVyLnR5cGUgPT09IGV2ZW50LnR5cGUpO1xyXG5cclxuICAgICAgICB0aGlzLnRvSGFuZGxlclBheWxvYWQgPSBwcm9wcy50b0hhbmRsZXJQYXlsb2FkID9cclxuICAgICAgICAgICAgcHJvcHMudG9IYW5kbGVyUGF5bG9hZC5iaW5kKHRoaXMpIDpcclxuICAgICAgICAgICAgKChsaXN0ZW5lciwgZXZlbnQpID0+IGV2ZW50KTtcclxuXHJcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMgPSBbXTtcclxuICAgIH1cclxuICAgIGFkZEV2ZW50TGlzdGVuZXIodHlwZSwgaGFuZGxlcikge1xyXG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KGhhbmRsZXIpKVxyXG4gICAgICAgICAgICByZXR1cm4gaGFuZGxlci5tYXAoaCA9PiB0aGlzLmFkZEV2ZW50TGlzdGVuZXIodHlwZSwgaCkpO1xyXG5cclxuICAgICAgICBpZiAodHlwZW9mIGhhbmRsZXIgIT09ICdmdW5jdGlvbicpXHJcbiAgICAgICAgICAgIHJldHVybjtcclxuXHJcbiAgICAgICAgY29uc3QgaWQgPSBNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyKTtcclxuICAgICAgICB0aGlzLmxpc3RlbmVycy5wdXNoKHt0eXBlLCBoYW5kbGVyLCBpZH0pO1xyXG5cclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICByZW1vdmU6ICgpID0+IHtcclxuICAgICAgICAgICAgICAgIGZvciAobGV0IGkgPSB0aGlzLmxpc3RlbmVycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICh0aGlzLmxpc3RlbmVyc1tpXS5pZCA9PT0gaWQpXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMubGlzdGVuZXJzLnNwbGljZShpLCAxKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbiAgICByZW1vdmVFdmVudExpc3RlbmVyKHR5cGUsIGhhbmRsZXIpIHtcclxuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShoYW5kbGVyKSlcclxuICAgICAgICAgICAgcmV0dXJuIGhhbmRsZXIubWFwKGggPT4gdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKHR5cGUsIGgpKTtcclxuXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IHRoaXMubGlzdGVuZXJzLmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XHJcbiAgICAgICAgICAgIGxldCBMID0gdGhpcy5saXN0ZW5lcnNbaV07XHJcbiAgICAgICAgICAgIGlmIChMLnR5cGUgPT09IHR5cGUgJiYgKCFoYW5kbGVyIHx8IEwuaGFuZGxlciA9PT0gaGFuZGxlcikpXHJcbiAgICAgICAgICAgICAgICB0aGlzLmxpc3RlbmVycy5zcGxpY2UoaSwgMSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgZGlzcGF0Y2hFdmVudCh0eXBlLCBwcm9wcykge1xyXG4gICAgICAgIGNvbnN0IGV2ZW50ID0gey4uLnByb3BzLCB0eXBlfTtcclxuXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IDAsIG4gPSB0aGlzLmxpc3RlbmVycy5sZW5ndGg7IGkgPCBuOyBpKyspIHtcclxuICAgICAgICAgICAgbGV0IEwgPSB0aGlzLmxpc3RlbmVyc1tpXTtcclxuICAgICAgICAgICAgaWYgKHRoaXMuc2hvdWxkQ2FsbExpc3RlbmVyKEwsIGV2ZW50KSlcclxuICAgICAgICAgICAgICAgIEwuaGFuZGxlcih0aGlzLnRvSGFuZGxlclBheWxvYWQoTCwgZXZlbnQpKTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IEV2ZW50TWFuYWdlcjtcclxuIiwiY2xhc3MgUHJveHlFbGVtZW50IHtcclxuICAgIGNvbnN0cnVjdG9yKGhvc3QsIHNlbGVjdG9yLCBhbGwgPSBmYWxzZSkge1xyXG4gICAgICAgIGlmICh0eXBlb2YgaG9zdCA9PT0gJ3N0cmluZycpIHtcclxuICAgICAgICAgICAgdGhpcy5ob3N0ID0gZG9jdW1lbnQ7XHJcbiAgICAgICAgICAgIHRoaXMuc2VsZWN0b3IgPSBob3N0O1xyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlIGlmIChob3N0IGluc3RhbmNlb2YgUHJveHlFbGVtZW50KSB7XHJcbiAgICAgICAgICAgIHRoaXMuaG9zdCA9IGhvc3QuaG9zdDtcclxuICAgICAgICAgICAgdGhpcy5zZWxlY3RvciA9IGhvc3Quc2VsZWN0b3IgKyAnICcgKyAoc2VsZWN0b3IgfHwgJycpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5ob3N0ID0gaG9zdCB8fCBkb2N1bWVudDtcclxuICAgICAgICAgICAgdGhpcy5zZWxlY3RvciA9IHNlbGVjdG9yO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgdGhpcy5zZWxlY3RvciA9IFN0cmluZyh0aGlzLnNlbGVjdG9yIHx8ICcnKS50cmltKCk7XHJcbiAgICAgICAgdGhpcy5hbGwgPSBhbGw7XHJcbiAgICAgICAgdGhpcy5saXN0ZW5lcnMgPSBbXTtcclxuICAgIH1cclxuICAgIHByb3h5U2VsZWN0b3Ioc2VsZWN0b3IpIHtcclxuICAgICAgICByZXR1cm4gbmV3IFByb3h5RWxlbWVudCh0aGlzLCBzZWxlY3Rvcik7XHJcbiAgICB9XHJcbiAgICBwcm94eVNlbGVjdG9yQWxsKHNlbGVjdG9yKSB7XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm94eUVsZW1lbnQodGhpcywgc2VsZWN0b3IsIHRydWUpO1xyXG4gICAgfVxyXG4gICAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlLCBoYW5kbGVyLCB1c2VDYXB0dXJlID0gZmFsc2UpIHtcclxuICAgICAgICBsZXQge2hvc3QsIHNlbGVjdG9yLCBhbGwsIGxpc3RlbmVyc30gPSB0aGlzO1xyXG5cclxuICAgICAgICBsZXQgcHJveHlIYW5kbGVyID0gZXZlbnQgPT4ge1xyXG4gICAgICAgICAgICBpZiAoIXNlbGVjdG9yKVxyXG4gICAgICAgICAgICAgICAgaGFuZGxlci5jYWxsKGhvc3QsIGV2ZW50KTtcclxuICAgICAgICAgICAgZWxzZSBpZiAoYWxsKSB7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGxldCB0ID0gZXZlbnQudGFyZ2V0OyB0OyB0ID0gdC5wYXJlbnROb2RlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB0Lm1hdGNoZXMgPT09ICdmdW5jdGlvbicgJiYgdC5tYXRjaGVzKHNlbGVjdG9yKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGVyLmNhbGwodCwgZXZlbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgZWxzZSB7XHJcbiAgICAgICAgICAgICAgICBsZXQgZSA9IGhvc3QucXVlcnlTZWxlY3RvcihzZWxlY3Rvcik7XHJcbiAgICAgICAgICAgICAgICBmb3IgKGxldCB0ID0gZXZlbnQudGFyZ2V0OyBlICYmIHQ7IHQgPSB0LnBhcmVudE5vZGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodCA9PT0gZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGVyLmNhbGwodCwgZXZlbnQpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBob3N0LmFkZEV2ZW50TGlzdGVuZXIodHlwZSwgcHJveHlIYW5kbGVyLCB1c2VDYXB0dXJlKTtcclxuICAgICAgICBsaXN0ZW5lcnMucHVzaCh7dHlwZSwgaGFuZGxlciwgdXNlQ2FwdHVyZSwgcHJveHlIYW5kbGVyfSk7XHJcbiAgICB9XHJcbiAgICByZW1vdmVFdmVudExpc3RlbmVyKHR5cGUsIGhhbmRsZXIsIHVzZUNhcHR1cmUgPSBmYWxzZSkge1xyXG4gICAgICAgIGxldCB7aG9zdCwgbGlzdGVuZXJzfSA9IHRoaXM7XHJcblxyXG4gICAgICAgIGZvciAobGV0IGkgPSBsaXN0ZW5lcnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcclxuICAgICAgICAgICAgbGV0IEwgPSBsaXN0ZW5lcnNbaV07XHJcblxyXG4gICAgICAgICAgICBpZiAoTC50eXBlID09PSB0eXBlICYmIEwuaGFuZGxlciA9PT0gaGFuZGxlciAmJiBMLnVzZUNhcHR1cmUgPT09IHVzZUNhcHR1cmUpIHtcclxuICAgICAgICAgICAgICAgIGhvc3QucmVtb3ZlRXZlbnRMaXN0ZW5lcih0eXBlLCBMLnByb3h5SGFuZGxlciwgdXNlQ2FwdHVyZSk7XHJcbiAgICAgICAgICAgICAgICBsaXN0ZW5lcnMuc3BsaWNlKGksIDEpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgZ2V0SG9zdCgpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5ob3N0O1xyXG4gICAgfVxyXG4gICAgcXVlcnkoKSB7XHJcbiAgICAgICAgbGV0IHtob3N0LCBzZWxlY3RvciwgYWxsfSA9IHRoaXM7XHJcblxyXG4gICAgICAgIGlmICghaG9zdClcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG5cclxuICAgICAgICBpZiAoIXNlbGVjdG9yKVxyXG4gICAgICAgICAgICByZXR1cm4gaG9zdDtcclxuXHJcbiAgICAgICAgcmV0dXJuIGFsbCA/XHJcbiAgICAgICAgICAgIGhvc3QucXVlcnlTZWxlY3RvckFsbChzZWxlY3RvcikgOlxyXG4gICAgICAgICAgICBob3N0LnF1ZXJ5U2VsZWN0b3Ioc2VsZWN0b3IpO1xyXG4gICAgfVxyXG59XHJcblxyXG5leHBvcnQgZGVmYXVsdCBQcm94eUVsZW1lbnQ7XHJcbiIsImltcG9ydCBQcm94eUVsZW1lbnQgZnJvbSAnLi9Qcm94eUVsZW1lbnQnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgKHNlbGVjdG9yLCBob3N0KSA9PiBuZXcgUHJveHlFbGVtZW50KGhvc3QsIHNlbGVjdG9yLCBmYWxzZSk7XHJcbiIsImltcG9ydCBQcm94eUVsZW1lbnQgZnJvbSAnLi9Qcm94eUVsZW1lbnQnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgKHNlbGVjdG9yLCBob3N0KSA9PiBuZXcgUHJveHlFbGVtZW50KGhvc3QsIHNlbGVjdG9yLCB0cnVlKTtcclxuIiwiZXhwb3J0IGRlZmF1bHQgeCA9PiB7XHJcbiAgICB0cnkge1xyXG4gICAgICAgIGxldCB1cmw7XHJcblxyXG4gICAgICAgIGlmICh4ID09PSBudWxsIHx8IHggPT09IHVuZGVmaW5lZClcclxuICAgICAgICAgICAgdXJsID0gbmV3IFVSTCh3aW5kb3cubG9jYXRpb24uaHJlZik7XHJcbiAgICAgICAgZWxzZSBpZiAoeC5ocmVmICE9PSB1bmRlZmluZWQpXHJcbiAgICAgICAgICAgIHVybCA9IG5ldyBVUkwoeC5ocmVmKTtcclxuICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgIHVybCA9IG5ldyBVUkwoeCwgd2luZG93LmxvY2F0aW9uLm9yaWdpbik7XHJcblxyXG4gICAgICAgIGxldCB7cGF0aG5hbWUsIHNlYXJjaCwgaGFzaH0gPSB1cmw7XHJcbiAgICAgICAgcmV0dXJuIHBhdGhuYW1lICsgc2VhcmNoICsgaGFzaDtcclxuICAgIH1cclxuICAgIGNhdGNoKGUpIHt9XHJcbn07XHJcbiIsImV4cG9ydCBkZWZhdWx0IGVsZW1lbnQgPT4ge1xyXG4gICAgaWYgKCFlbGVtZW50IHx8IGVsZW1lbnQuaHJlZiA9PT0gdW5kZWZpbmVkKVxyXG4gICAgICAgIHJldHVybiBmYWxzZTtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICAgIHJldHVybiBuZXcgVVJMKGVsZW1lbnQuaHJlZikub3JpZ2luID09PSB3aW5kb3cubG9jYXRpb24ub3JpZ2luO1xyXG4gICAgfVxyXG4gICAgY2F0Y2goZSkge31cclxufTtcclxuIiwiZXhwb3J0IGRlZmF1bHQgeCA9PiBBcnJheS5pc0FycmF5KHgpIHx8IHggaW5zdGFuY2VvZiBOb2RlTGlzdCB8fCB4IGluc3RhbmNlb2YgSFRNTENvbGxlY3Rpb247XHJcbiIsImV4cG9ydCBkZWZhdWx0IHtcclxuICAgIFJPVVRFX0NIQU5HRTogJ1JPVVRFX0NIQU5HRScsXHJcbn07XHJcbiIsImltcG9ydCBFdmVudE1hbmFnZXIgZnJvbSAnZXZlbnQtbWFuYWdlcic7XHJcbmltcG9ydCBnZXRGdWxsUGF0aCBmcm9tICcuLi9saWIvZ2V0RnVsbFBhdGgnO1xyXG5pbXBvcnQgaXNOYXZpZ2FibGUgZnJvbSAnLi4vbGliL2lzTmF2aWdhYmxlJztcclxuaW1wb3J0IGlzQ29sbGVjdGlvbiBmcm9tICcuLi9saWIvaXNDb2xsZWN0aW9uJztcclxuaW1wb3J0IEV2ZW50IGZyb20gJy4uL2xpYi9FdmVudCc7XHJcblxyXG5jbGFzcyBSb3V0ZSB7XHJcbiAgICBjb25zdHJ1Y3RvcigpIHtcclxuICAgICAgICB0aGlzLmV2ZW50TWFuYWdlciA9IG5ldyBFdmVudE1hbmFnZXIoKTtcclxuICAgICAgICB0aGlzLnN1YnNjcmlwdGlvbnMgPSBbXTtcclxuXHJcbiAgICAgICAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ3BvcHN0YXRlJywgKCkgPT4gdGhpcy5kaXNwYXRjaFJvdXRlKCkpO1xyXG4gICAgfVxyXG4gICAgZGlzcGF0Y2hSb3V0ZShwYXRoKSB7XHJcbiAgICAgICAgdGhpcy5ldmVudE1hbmFnZXIuZGlzcGF0Y2hFdmVudChFdmVudC5ST1VURV9DSEFOR0UsIHtcclxuICAgICAgICAgICAgcGF0aDogcGF0aCA9PT0gdW5kZWZpbmVkID8gZ2V0RnVsbFBhdGgoKSA6IHBhdGgsXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBzdWJzY3JpYmUodGFyZ2V0KSB7XHJcbiAgICAgICAgbGV0IGhhbmRsZXI7XHJcblxyXG4gICAgICAgIGlmICghdGFyZ2V0KVxyXG4gICAgICAgICAgICByZXR1cm47XHJcblxyXG4gICAgICAgIC8vIGFycmF5LWxpa2UgY29sbGVjdGlvblxyXG4gICAgICAgIGVsc2UgaWYgKGlzQ29sbGVjdGlvbih0YXJnZXQpKSB7XHJcbiAgICAgICAgICAgIGZvciAobGV0IHQgb2YgdGFyZ2V0KSB0aGlzLnN1YnNjcmliZSh0KTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIC8vIHNlbGVjdG9yXHJcbiAgICAgICAgZWxzZSBpZiAodHlwZW9mIHRhcmdldCA9PT0gJ3N0cmluZycpXHJcbiAgICAgICAgICAgIGRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgaGFuZGxlciA9IGV2ZW50ID0+IHtcclxuICAgICAgICAgICAgICAgIGZvciAobGV0IHQgPSBldmVudC50YXJnZXQ7IHQ7IHQgPSB0LnBhcmVudE5vZGUpIHtcclxuICAgICAgICAgICAgICAgICAgICBpZiAodC5tYXRjaGVzICYmIHQubWF0Y2hlcyh0YXJnZXQpICYmIGlzTmF2aWdhYmxlKHQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuYXNzaWduKGdldEZ1bGxQYXRoKHQpKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICBlbHNlIGlmICh0YXJnZXQgaW5zdGFuY2VvZiBIVE1MRWxlbWVudClcclxuICAgICAgICAgICAgdGFyZ2V0LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgaGFuZGxlciA9IGV2ZW50ID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChpc05hdmlnYWJsZSh0YXJnZXQpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICAgICAgICAgICAgICB0aGlzLmFzc2lnbihnZXRGdWxsUGF0aCh0YXJnZXQpKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgIC8vIFJvdXRlclxyXG4gICAgICAgIGVsc2UgaWYgKHRhcmdldC5kaXNwYXRjaFJvdXRlKVxyXG4gICAgICAgICAgICB0aGlzLmV2ZW50TWFuYWdlci5hZGRFdmVudExpc3RlbmVyKEV2ZW50LlJPVVRFX0NIQU5HRSwgaGFuZGxlciA9IGV2ZW50ID0+IHtcclxuICAgICAgICAgICAgICAgIHRhcmdldC5kaXNwYXRjaFJvdXRlKGV2ZW50LnBhdGgpO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgaWYgKGhhbmRsZXIpXHJcbiAgICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5wdXNoKHt0YXJnZXQsIGhhbmRsZXJ9KTtcclxuICAgIH1cclxuICAgIHVuc3Vic2NyaWJlKHRhcmdldCkge1xyXG4gICAgICAgIGlmICghdGFyZ2V0KVxyXG4gICAgICAgICAgICByZXR1cm47XHJcblxyXG4gICAgICAgIGlmIChpc0NvbGxlY3Rpb24odGFyZ2V0KSkge1xyXG4gICAgICAgICAgICBmb3IgKGxldCB0IG9mIHRhcmdldCkgdGhpcy51bnN1YnNjcmliZSh0KTtcclxuICAgICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZm9yIChsZXQgaSA9IHRoaXMuc3Vic2NyaXB0aW9ucy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xyXG4gICAgICAgICAgICBsZXQge3RhcmdldDogdCwgaGFuZGxlcjogZn0gPSB0aGlzLnN1YnNjcmlwdGlvbnNbaV07XHJcblxyXG4gICAgICAgICAgICBpZiAodCAhPT0gdGFyZ2V0KVxyXG4gICAgICAgICAgICAgICAgY29udGludWU7XHJcblxyXG4gICAgICAgICAgICBpZiAodHlwZW9mIHQgPT09ICdzdHJpbmcnKVxyXG4gICAgICAgICAgICAgICAgZG9jdW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcignY2xpY2snLCBmKTtcclxuXHJcbiAgICAgICAgICAgIGVsc2UgaWYgKHQgaW5zdGFuY2VvZiBIVE1MRWxlbWVudClcclxuICAgICAgICAgICAgICAgIHQucmVtb3ZlRXZlbnRMaXN0ZW5lcignY2xpY2snLCBmKTtcclxuXHJcbiAgICAgICAgICAgIGVsc2UgaWYgKHQuZGlzcGF0Y2hSb3V0ZSlcclxuICAgICAgICAgICAgICAgIHRoaXMuZXZlbnRNYW5hZ2VyLnJlbW92ZUV2ZW50TGlzdGVuZXIoRXZlbnQuUk9VVEVfQ0hBTkdFLCBmKTtcclxuXHJcbiAgICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5zcGxpY2UoaSwgMSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgYXNzaWduKHBhdGgpIHtcclxuICAgICAgICBoaXN0b3J5LnB1c2hTdGF0ZSh7fSwgJycsIHBhdGgpO1xyXG4gICAgICAgIHRoaXMuZGlzcGF0Y2hSb3V0ZSgpO1xyXG4gICAgfVxyXG4gICAgcmVwbGFjZShwYXRoKSB7XHJcbiAgICAgICAgaGlzdG9yeS5yZXBsYWNlU3RhdGUoe30sICcnLCBwYXRoKTtcclxuICAgICAgICB0aGlzLmRpc3BhdGNoUm91dGUoKTtcclxuICAgIH1cclxuICAgIHJlbG9hZCgpIHtcclxuICAgICAgICB0aGlzLmRpc3BhdGNoUm91dGUoKTtcclxuICAgIH1cclxuICAgIHRvU3RyaW5nKCkge1xyXG4gICAgICAgIHJldHVybiBnZXRGdWxsUGF0aCgpO1xyXG4gICAgfVxyXG4gICAgZ28oZGVsdGEpIHtcclxuICAgICAgICBoaXN0b3J5LmdvKGRlbHRhKTtcclxuICAgIH1cclxuICAgIGJhY2soKSB7XHJcbiAgICAgICAgdGhpcy5nbygtMSk7XHJcbiAgICB9XHJcbiAgICBmb3J3YXJkKCkge1xyXG4gICAgICAgIHRoaXMuZ28oMSk7XHJcbiAgICB9XHJcbn1cclxuXHJcbmV4cG9ydCBkZWZhdWx0IG5ldyBSb3V0ZSgpO1xyXG4iLCJpbXBvcnQgRXZlbnRNYW5hZ2VyIGZyb20gJ2V2ZW50LW1hbmFnZXInO1xyXG5pbXBvcnQgZ2V0RnVsbFBhdGggZnJvbSAnLi4vbGliL2dldEZ1bGxQYXRoJztcclxuaW1wb3J0IHJvdXRlIGZyb20gJy4vcm91dGUnO1xyXG5cclxuY2xhc3MgUm91dGVyIHtcclxuICAgIGNvbnN0cnVjdG9yKHByb3BzID0ge30pIHtcclxuICAgICAgICB0aGlzLnNldEJhc2VSb3V0ZShwcm9wcy5iYXNlUm91dGUpO1xyXG5cclxuICAgICAgICB0aGlzLmV2ZW50TWFuYWdlciA9IG5ldyBFdmVudE1hbmFnZXIoe1xyXG4gICAgICAgICAgICBzaG91bGRDYWxsTGlzdGVuZXI6IChsaXN0ZW5lciwgZXZlbnQpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmICghdGhpcy5tYXRjaGVzQmFzZVJvdXRlKGV2ZW50LnR5cGUpKVxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuXHJcbiAgICAgICAgICAgICAgICBsZXQgcm91dGVQYXR0ZXJuID0gbGlzdGVuZXIudHlwZTtcclxuICAgICAgICAgICAgICAgIGxldCBwYXRoID0gdGhpcy50cnVuY2F0ZUJhc2VSb3V0ZShldmVudC50eXBlKTtcclxuXHJcbiAgICAgICAgICAgICAgICBpZiAocHJvcHMuc2hvdWxkQ2FsbExpc3RlbmVyKVxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBwcm9wcy5zaG91bGRDYWxsTGlzdGVuZXIuY2FsbCh0aGlzLCByb3V0ZVBhdHRlcm4sIHBhdGgpO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybiByb3V0ZVBhdHRlcm4gaW5zdGFuY2VvZiBSZWdFeHAgP1xyXG4gICAgICAgICAgICAgICAgICAgIHJvdXRlUGF0dGVybi50ZXN0KHBhdGgpIDpcclxuICAgICAgICAgICAgICAgICAgICByb3V0ZVBhdHRlcm4gPT09IHBhdGg7XHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICAgIHRvSGFuZGxlclBheWxvYWQ6IChsaXN0ZW5lciwgZXZlbnQpID0+IHtcclxuICAgICAgICAgICAgICAgIGxldCByb3V0ZVBhdHRlcm4gPSBsaXN0ZW5lci50eXBlO1xyXG4gICAgICAgICAgICAgICAgbGV0IHBhdGggPSB0aGlzLnRydW5jYXRlQmFzZVJvdXRlKGV2ZW50LnR5cGUpO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChwcm9wcy50b0hhbmRsZXJQYXlsb2FkKVxyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBwcm9wcy50b0hhbmRsZXJQYXlsb2FkLmNhbGwodGhpcywgcm91dGVQYXR0ZXJuLCBwYXRoKTtcclxuXHJcbiAgICAgICAgICAgICAgICBsZXQgcGFyYW1zID0gcm91dGVQYXR0ZXJuIGluc3RhbmNlb2YgUmVnRXhwID9cclxuICAgICAgICAgICAgICAgICAgICBwYXRoLm1hdGNoKHJvdXRlUGF0dGVybikgfHwgW10gOlxyXG4gICAgICAgICAgICAgICAgICAgIFtdO1xyXG5cclxuICAgICAgICAgICAgICAgIHJldHVybiB7cGFyYW1zLCBwYXRofTtcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgcm91dGUuc3Vic2NyaWJlKHRoaXMpO1xyXG4gICAgfVxyXG4gICAgc2V0QmFzZVJvdXRlKGJhc2VSb3V0ZSkge1xyXG4gICAgICAgIHRoaXMuYmFzZVJvdXRlID0gKGJhc2VSb3V0ZSB8fCAnJykucmVwbGFjZSgvXFwvJC8sICcnKTtcclxuICAgIH1cclxuICAgIG1hdGNoZXNCYXNlUm91dGUocGF0aCkge1xyXG4gICAgICAgIGNvbnN0IHtiYXNlUm91dGV9ID0gdGhpcztcclxuXHJcbiAgICAgICAgcmV0dXJuICFiYXNlUm91dGUgfHwgcGF0aCA9PT0gYmFzZVJvdXRlIHx8XHJcbiAgICAgICAgICAgIChwYXRoICYmIFsnLycsICc/JywgJyMnXS5zb21lKGMgPT4gcGF0aC5zdGFydHNXaXRoKGJhc2VSb3V0ZSArIGMpKSk7XHJcbiAgICB9XHJcbiAgICB0cnVuY2F0ZUJhc2VSb3V0ZShwYXRoKSB7XHJcbiAgICAgICAgY29uc3Qge2Jhc2VSb3V0ZX0gPSB0aGlzO1xyXG5cclxuICAgICAgICBpZiAoIXBhdGggfHwgIWJhc2VSb3V0ZSB8fCAhcGF0aC5zdGFydHNXaXRoKGJhc2VSb3V0ZSkpXHJcbiAgICAgICAgICAgIHJldHVybiBwYXRoO1xyXG5cclxuICAgICAgICByZXR1cm4gcGF0aC5zbGljZShiYXNlUm91dGUubGVuZ3RoKTtcclxuICAgIH1cclxuICAgIGFkZFJvdXRlTGlzdGVuZXIocm91dGVQYXR0ZXJuLCBoYW5kbGVyKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuZXZlbnRNYW5hZ2VyLmFkZEV2ZW50TGlzdGVuZXIocm91dGVQYXR0ZXJuLCBoYW5kbGVyKTtcclxuICAgIH1cclxuICAgIHJlbW92ZVJvdXRlTGlzdGVuZXIocm91dGVQYXR0ZXJuLCBoYW5kbGVyKSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuZXZlbnRNYW5hZ2VyLnJlbW92ZUV2ZW50TGlzdGVuZXIocm91dGVQYXR0ZXJuLCBoYW5kbGVyKTtcclxuICAgIH1cclxuICAgIGRpc3BhdGNoUm91dGUocGF0aCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLmV2ZW50TWFuYWdlci5kaXNwYXRjaEV2ZW50KHBhdGggPT09IHVuZGVmaW5lZCA/IGdldEZ1bGxQYXRoKCkgOiBwYXRoKTtcclxuICAgIH1cclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgUm91dGVyO1xyXG4iLCJjb25zdCBjYWNoZSA9IHt9O1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKHRhZ05hbWUsIGF0dHJzLCB0YXJnZXROb2RlKSA9PiB7XHJcbiAgICBsZXQgYXR0ckVudHJpZXMgPSBPYmplY3QuZW50cmllcyhhdHRycyk7XHJcbiAgICBsZXQgc2VsZWN0b3IgPSBgJHt0YWdOYW1lfSR7YXR0ckVudHJpZXMubWFwKChbaywgdl0pID0+IGBbJHtrfT1cIiR7dn1cIl1gKS5qb2luKCcnKX1gO1xyXG4gICAgbGV0IGUgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKHNlbGVjdG9yKTtcclxuXHJcbiAgICBpZiAoZSlcclxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGUpO1xyXG5cclxuICAgIGlmIChjYWNoZVtzZWxlY3Rvcl0pXHJcbiAgICAgICAgcmV0dXJuIGNhY2hlW3NlbGVjdG9yXTtcclxuXHJcbiAgICByZXR1cm4gKGNhY2hlW3NlbGVjdG9yXSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgICBsZXQgZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnTmFtZSk7XHJcblxyXG4gICAgICAgIGUuYWRkRXZlbnRMaXN0ZW5lcignbG9hZCcsICgpID0+IHtcclxuICAgICAgICAgICAgZGVsZXRlIGNhY2hlW3NlbGVjdG9yXTtcclxuICAgICAgICAgICAgcmVzb2x2ZShlKTtcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgZS5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsICgpID0+IHtcclxuICAgICAgICAgICAgZGVsZXRlIGNhY2hlW3NlbGVjdG9yXTtcclxuICAgICAgICAgICAgcmVqZWN0KGUpO1xyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBmb3IgKGxldCBbaywgdl0gb2YgYXR0ckVudHJpZXMpXHJcbiAgICAgICAgICAgIGUuc2V0QXR0cmlidXRlKGssIHYpO1xyXG5cclxuICAgICAgICAodGFyZ2V0Tm9kZSB8fCBkb2N1bWVudC5oZWFkKS5hcHBlbmRDaGlsZChlKTtcclxuICAgIH0pKTtcclxufTtcclxuIiwiaW1wb3J0IGltcG9ydFJlc291cmNlIGZyb20gJy4vaW1wb3J0UmVzb3VyY2UnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKHNyYywgYXR0cnMpID0+IHtcclxuICAgIHJldHVybiBhd2FpdCBpbXBvcnRSZXNvdXJjZSgnc2NyaXB0Jywgey4uLmF0dHJzLCBzcmN9KTtcclxufTtcclxuIiwiaW1wb3J0IGltcG9ydFJlc291cmNlIGZyb20gJy4vaW1wb3J0UmVzb3VyY2UnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgYXN5bmMgKGhyZWYsIGF0dHJzKSA9PiB7XHJcbiAgICByZXR1cm4gYXdhaXQgaW1wb3J0UmVzb3VyY2UoJ2xpbmsnLCB7cmVsOiAnc3R5bGVzaGVldCcsIC4uLmF0dHJzLCBocmVmfSk7XHJcbn07XHJcbiIsImNsYXNzIE1lbW9yeVN0b3JhZ2Uge1xyXG4gICAgY29uc3RydWN0b3IoY2FwYWNpdHkpIHtcclxuICAgICAgICB0aGlzLl9zdG9yYWdlID0gT2JqZWN0LmNyZWF0ZShudWxsKTtcclxuICAgICAgICB0aGlzLl9rZXlzID0gW107XHJcbiAgICAgICAgdGhpcy5zZXRDYXBhY2l0eShjYXBhY2l0eSk7XHJcbiAgICB9XHJcbiAgICBzZXRDYXBhY2l0eShjYXBhY2l0eSkge1xyXG4gICAgICAgIHRoaXMuY2FwYWNpdHkgPSB0eXBlb2YgY2FwYWNpdHkgPT09ICdudW1iZXInID8gY2FwYWNpdHkgOiBJbmZpbml0eTtcclxuICAgICAgICB0aGlzLnJldmlzZSgpO1xyXG4gICAgfVxyXG4gICAgcmV2aXNlKCkge1xyXG4gICAgICAgIHdoaWxlICh0aGlzLl9rZXlzLmxlbmd0aCA+IE1hdGgubWF4KHRoaXMuY2FwYWNpdHksIDApKVxyXG4gICAgICAgICAgICB0aGlzLnJlbW92ZUl0ZW0odGhpcy5fa2V5c1swXSk7XHJcbiAgICB9XHJcbiAgICBnZXRJdGVtKGtleSkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9zdG9yYWdlW2tleV07XHJcbiAgICB9XHJcbiAgICBzZXRJdGVtKGtleSwgdmFsdWUpIHtcclxuICAgICAgICB0aGlzLl9rZXlzLnB1c2goa2V5KTtcclxuICAgICAgICB0aGlzLl9zdG9yYWdlW2tleV0gPSB2YWx1ZTtcclxuICAgICAgICB0aGlzLnJldmlzZSgpO1xyXG4gICAgfVxyXG4gICAgcmVtb3ZlSXRlbShrZXkpIHtcclxuICAgICAgICBsZXQgayA9IHRoaXMuX2tleXMuaW5kZXhPZihrZXkpO1xyXG5cclxuICAgICAgICBpZiAoayAhPT0gLTEpIHtcclxuICAgICAgICAgICAgZGVsZXRlIHRoaXMuX3N0b3JhZ2Vba2V5XTtcclxuICAgICAgICAgICAgdGhpcy5fa2V5cy5zcGxpY2UoaywgMSk7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG4gICAgY2xlYXIoKSB7XHJcbiAgICAgICAgdGhpcy5fc3RvcmFnZSA9IE9iamVjdC5jcmVhdGUobnVsbCk7XHJcbiAgICAgICAgdGhpcy5fa2V5cyA9IFtdO1xyXG4gICAgfVxyXG4gICAga2V5KGluZGV4KSB7XHJcbiAgICAgICAgcmV0dXJuIHRoaXMuX2tleXNbaW5kZXhdO1xyXG4gICAgfVxyXG4gICAga2V5cygpIHtcclxuICAgICAgICByZXR1cm4gdGhpcy5fa2V5cy5zbGljZSgpO1xyXG4gICAgfVxyXG4gICAgbGVuZ3RoKCkge1xyXG4gICAgICAgIHJldHVybiB0aGlzLl9rZXlzLmxlbmd0aDtcclxuICAgIH1cclxuICAgIGl0ZXJhdGUoY2FsbGJhY2spIHtcclxuICAgICAgICB0aGlzLl9rZXlzLmZvckVhY2goKGtleSwgaW5kZXgpID0+IGNhbGxiYWNrKHRoaXMuX3N0b3JhZ2Vba2V5XSwga2V5LCBpbmRleCkpO1xyXG4gICAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IE1lbW9yeVN0b3JhZ2U7XHJcbiIsImNvbnN0IE1lbW9yeVN0b3JhZ2UgPSByZXF1aXJlKCdtZW1vcnktc3RvcmFnZScpO1xyXG5cclxuY2xhc3MgVm9sYXRpbGVTdG9yYWdlIHtcclxuICAgIGNvbnN0cnVjdG9yKHByb3BzID0ge30pIHtcclxuICAgICAgICB0aGlzLnN0b3JhZ2UgPSBwcm9wcy5zdG9yYWdlIHx8IG5ldyBNZW1vcnlTdG9yYWdlKCk7XHJcbiAgICAgICAgdGhpcy5ucyA9IHByb3BzLm5zID8gcHJvcHMubnMgKyAnLicgOiAnJztcclxuICAgICAgICB0aGlzLnZlcnNpb24gPSBwcm9wcy52ZXJzaW9uO1xyXG5cclxuICAgICAgICB0aGlzLnNldENhcGFjaXR5KHByb3BzLmNhcGFjaXR5KTtcclxuICAgICAgICB0aGlzLnNldE1heEFnZShwcm9wcy5tYXhBZ2UpO1xyXG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZXZpc2lvbigpO1xyXG4gICAgfVxyXG4gICAgc2V0Q2FwYWNpdHkoY2FwYWNpdHkpIHtcclxuICAgICAgICB0aGlzLmNhcGFjaXR5ID0gdHlwZW9mIGNhcGFjaXR5ID09PSAnbnVtYmVyJyA/IGNhcGFjaXR5IDogSW5maW5pdHk7XHJcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJldmlzaW9uKCk7XHJcbiAgICB9XHJcbiAgICBzZXRNYXhBZ2UobWF4QWdlKSB7XHJcbiAgICAgICAgdGhpcy5tYXhBZ2UgPSB0eXBlb2YgbWF4QWdlID09PSAnbnVtYmVyJyA/IG1heEFnZSA6IEluZmluaXR5O1xyXG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZXZpc2lvbigpO1xyXG4gICAgfVxyXG4gICAgaGFzVmFsaWRDb250ZW50KGl0ZW0pIHtcclxuICAgICAgICByZXR1cm4gKFxyXG4gICAgICAgICAgICBCb29sZWFuKGl0ZW0pICYmXHJcbiAgICAgICAgICAgIGl0ZW0udCArIHRoaXMubWF4QWdlID4gRGF0ZS5ub3coKSAmJlxyXG4gICAgICAgICAgICBpdGVtLnYgPT09IHRoaXMudmVyc2lvblxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcbiAgICBhc3luYyBnZXRJdGVtKGtleSkge1xyXG4gICAgICAgIGxldCB0ID0gRGF0ZS5ub3coKSwgaXRlbTtcclxuXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgbGV0IHN0b3JlZFZhbHVlID0gYXdhaXQgdGhpcy5zdG9yYWdlLmdldEl0ZW0odGhpcy5ucyArIGtleSk7XHJcbiAgICAgICAgICAgIGl0ZW0gPSBKU09OLnBhcnNlKHN0b3JlZFZhbHVlKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgY2F0Y2goZSkge31cclxuXHJcbiAgICAgICAgaWYgKHRoaXMuaGFzVmFsaWRDb250ZW50KGl0ZW0pKSByZXR1cm4gaXRlbS54O1xyXG4gICAgICAgIGVsc2UgaWYgKGl0ZW0pIHRoaXMucmVtb3ZlSXRlbShrZXkpO1xyXG4gICAgfVxyXG4gICAgYXN5bmMgc2V0SXRlbShrZXksIHZhbHVlLCBvcHRpb25zKSB7XHJcbiAgICAgICAgbGV0IGl0ZW0gPSB7eDogdmFsdWUsIHQ6IERhdGUubm93KCksIHY6IHRoaXMudmVyc2lvbn07XHJcblxyXG4gICAgICAgIGF3YWl0IHRoaXMuc3RvcmFnZS5zZXRJdGVtKHRoaXMubnMgKyBrZXksIEpTT04uc3RyaW5naWZ5KGl0ZW0pKTtcclxuICAgICAgICB0aGlzLnNjaGVkdWxlUmV2aXNpb24oKTtcclxuICAgIH1cclxuICAgIGFzeW5jIHJlbW92ZUl0ZW0oa2V5KSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5zdG9yYWdlLnJlbW92ZUl0ZW0odGhpcy5ucyArIGtleSk7XHJcbiAgICB9XHJcbiAgICBhc3luYyBrZXkoaW5kZXgpIHtcclxuICAgICAgICByZXR1cm4gYXdhaXQgdGhpcy5zdG9yYWdlLmtleShpbmRleCk7XHJcbiAgICB9XHJcbiAgICBhc3luYyBjbGVhcigpIHtcclxuICAgICAgICBhd2FpdCB0aGlzLnN0b3JhZ2UuY2xlYXIoKTtcclxuICAgIH1cclxuICAgIGFzeW5jIGtleXMoKSB7XHJcbiAgICAgICAgbGV0IHtzdG9yYWdlLCBuc30gPSB0aGlzLCBrZXlzO1xyXG5cclxuICAgICAgICBpZiAodHlwZW9mIHN0b3JhZ2Uua2V5cyA9PT0gJ2Z1bmN0aW9uJylcclxuICAgICAgICAgICAga2V5cyA9IGF3YWl0IHN0b3JhZ2Uua2V5cygpO1xyXG4gICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICBrZXlzID0gW107XHJcblxyXG4gICAgICAgICAgICBsZXQgc2l6ZSA9IHR5cGVvZiBzdG9yYWdlLmxlbmd0aCA9PT0gJ2Z1bmN0aW9uJyA/XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBzdG9yYWdlLmxlbmd0aCgpIDpcclxuICAgICAgICAgICAgICAgIHN0b3JhZ2UubGVuZ3RoO1xyXG5cclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBzaXplOyBpKyspXHJcbiAgICAgICAgICAgICAgICBrZXlzLnB1c2goYXdhaXQgc3RvcmFnZS5rZXkoaSkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKG5zKSB7XHJcbiAgICAgICAgICAgIGtleXMgPSBrZXlzXHJcbiAgICAgICAgICAgICAgICAuZmlsdGVyKGtleSA9PiBrZXkgJiYga2V5LnN0YXJ0c1dpdGgobnMpKVxyXG4gICAgICAgICAgICAgICAgLm1hcChrZXkgPT4ga2V5LnNsaWNlKG5zLmxlbmd0aCkpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGtleXM7XHJcbiAgICB9XHJcbiAgICBhc3luYyByZXZpc2UoKSB7XHJcbiAgICAgICAgbGV0IGtleXMgPSBhd2FpdCB0aGlzLmtleXMoKTtcclxuICAgICAgICBsZXQgb3ZlcmZsb3cgPSBrZXlzLmxlbmd0aCAtIHRoaXMuY2FwYWNpdHk7XHJcblxyXG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChcclxuICAgICAgICAgICAga2V5cy5tYXAoYXN5bmMgKGtleSwgaSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgaWYgKGkgPCBvdmVyZmxvdykgYXdhaXQgdGhpcy5yZW1vdmVJdGVtKGtleSk7XHJcbiAgICAgICAgICAgICAgICAvLyBnZXRJdGVtKCkgb24gZXhwaXJlZCBpdGVtcyB3aWxsIHJlbW92ZSB0aGVtXHJcbiAgICAgICAgICAgICAgICBlbHNlIGF3YWl0IHRoaXMuZ2V0SXRlbShrZXkpO1xyXG4gICAgICAgICAgICB9KVxyXG4gICAgICAgICk7XHJcbiAgICB9XHJcbiAgICBzY2hlZHVsZVJldmlzaW9uKCkge1xyXG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl9yZXZpc2lvblRpbWVvdXQpO1xyXG4gICAgICAgIHRoaXMuX3JldmlzaW9uVGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4gdGhpcy5yZXZpc2UoKSwgNTApO1xyXG4gICAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFZvbGF0aWxlU3RvcmFnZTtcclxuIiwiLy8gPG1ldGEgbmFtZT1cIm5zLnByb3BcIiBjb250ZW50PVwieHh4XCI+XHJcbmV4cG9ydCBkZWZhdWx0IChuYW1lLCBucykgPT4ge1xyXG4gICAgaWYgKCFuYW1lKVxyXG4gICAgICAgIHJldHVybjtcclxuXHJcbiAgICBsZXQgbWV0YSA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoYG1ldGFbbmFtZT1cIiR7KG5zID8gbnMgKyAnLicgOiAnJykgKyBuYW1lfVwiYCk7XHJcbiAgICBcclxuICAgIGlmIChtZXRhKVxyXG4gICAgICAgIHJldHVybiBtZXRhLmNvbnRlbnQ7XHJcbn07XHJcbiIsIi8vIDxodG1sIGRhdGEtbnMtcHJvcD1cInh4eFwiPlxyXG5leHBvcnQgZGVmYXVsdCAobmFtZSwgbnMpID0+IHtcclxuICAgIGlmICghbmFtZSlcclxuICAgICAgICByZXR1cm47XHJcblxyXG4gICAgbGV0IGF0dHJOYW1lcyA9IG5zID8gW1xyXG4gICAgICAgIC8vIHNhbXBsZVByb3AgPiBkYXRhLW5zLXNhbXBsZS1wcm9wID4gZGF0YXNldC5uc1NhbXBsZVByb3BcclxuICAgICAgICBucyArIG5hbWVbMF0udG9VcHBlckNhc2UoKSArIG5hbWUuc2xpY2UoMSksXHJcbiAgICAgICAgLy8gc2FtcGxlUHJvcCA+IGRhdGEtbnMtc2FtcGxlUHJvcCA+IGRhdGFzZXQubnNTYW1wbGVwcm9wXHJcbiAgICAgICAgbnMgKyBuYW1lWzBdLnRvVXBwZXJDYXNlKCkgKyBuYW1lLnNsaWNlKDEpLnRvTG93ZXJDYXNlKCksXHJcbiAgICBdIDogW1xyXG4gICAgICAgIC8vIHNhbXBsZVByb3AgPiBkYXRhLXNhbXBsZS1wcm9wID4gZGF0YXNldC5zYW1wbGVQcm9wXHJcbiAgICAgICAgbmFtZSxcclxuICAgICAgICAvLyBzYW1wbGVQcm9wID4gZGF0YS1zYW1wbGVQcm9wID4gZGF0YXNldC5zYW1wbGVwcm9wXHJcbiAgICAgICAgbmFtZS50b0xvd2VyQ2FzZSgpLFxyXG4gICAgXTtcclxuXHJcbiAgICByZXR1cm4gYXR0ck5hbWVzXHJcbiAgICAgICAgLm1hcChhdHRyID0+IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5kYXRhc2V0W2F0dHJdKVxyXG4gICAgICAgIC5maW5kKHggPT4geCAhPT0gdW5kZWZpbmVkKTtcclxufTtcclxuIiwiaW1wb3J0IGdldE1ldGEgZnJvbSAnLi4vbGliL2dldE1ldGEnO1xyXG5pbXBvcnQgZ2V0Um9vdERhdGFBdHRyaWJ1dGUgZnJvbSAnLi4vbGliL2dldFJvb3REYXRhQXR0cmlidXRlJztcclxuXHJcbmV4cG9ydCBkZWZhdWx0IChvcHRpb25zID0ge30pID0+IHtcclxuICAgIGxldCB7bnMsIHByb3BzLCB0cmFuc2Zvcm0gPSB7fX0gPSBvcHRpb25zO1xyXG4gICAgbGV0IGFwcGx5VHJhbnNmb3JtID0gKGssIHYpID0+IHR5cGVvZiB0cmFuc2Zvcm1ba10gPT09ICdmdW5jdGlvbicgPyB0cmFuc2Zvcm1ba10odikgOiB2O1xyXG4gICAgbGV0IGNvbmZpZyA9IE9iamVjdC5jcmVhdGUobnVsbCk7XHJcblxyXG4gICAgaWYgKEFycmF5LmlzQXJyYXkocHJvcHMpKSB7XHJcbiAgICAgICAgZm9yIChsZXQgayBvZiBwcm9wcykge1xyXG4gICAgICAgICAgICBsZXQgdmFsdWUgPSBbZ2V0TWV0YShrLCBucyksIGdldFJvb3REYXRhQXR0cmlidXRlKGssIG5zKV1cclxuICAgICAgICAgICAgICAgIC5maW5kKHggPT4geCAhPT0gdW5kZWZpbmVkKTtcclxuXHJcbiAgICAgICAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKVxyXG4gICAgICAgICAgICAgICAgY29uZmlnW2tdID0gYXBwbHlUcmFuc2Zvcm0oaywgdmFsdWUpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIGVsc2UgaWYgKG5zKSB7XHJcbiAgICAgICAgZm9yIChsZXQgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5kYXRhc2V0KSkge1xyXG4gICAgICAgICAgICAvLyBrID0gPG5zPjx1cHBlcmNhc2UgY2hhcmFjdGVyPjxyZXN0PlxyXG4gICAgICAgICAgICBsZXQgbWF0Y2hlc05TID0gKFxyXG4gICAgICAgICAgICAgICAgay5zdGFydHNXaXRoKG5zKSAmJlxyXG4gICAgICAgICAgICAgICAga1tucy5sZW5ndGhdICYmXHJcbiAgICAgICAgICAgICAgICBrW25zLmxlbmd0aF0gPT09IGtbbnMubGVuZ3RoXS50b1VwcGVyQ2FzZSgpXHJcbiAgICAgICAgICAgICk7XHJcblxyXG4gICAgICAgICAgICBpZiAobWF0Y2hlc05TKSB7XHJcbiAgICAgICAgICAgICAgICBsZXQga2V5ID0gay5zbGljZShucy5sZW5ndGgpO1xyXG5cclxuICAgICAgICAgICAgICAgIGlmIChrZXkpIHtcclxuICAgICAgICAgICAgICAgICAgICBrZXkgPSBrZXlbMF0udG9Mb3dlckNhc2UoKSArIGtleS5zbGljZSgxKTtcclxuXHJcbiAgICAgICAgICAgICAgICAgICAgY29uZmlnW2tleV0gPSBhcHBseVRyYW5zZm9ybShrZXksIHYpO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmb3IgKGxldCBtZXRhIG9mIGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoYG1ldGFbbmFtZV49XCIke25zfS5cIl1gKSkge1xyXG4gICAgICAgICAgICBsZXQga2V5ID0gbWV0YS5uYW1lLnNsaWNlKG5zLmxlbmd0aCArIDEpO1xyXG5cclxuICAgICAgICAgICAgaWYgKGtleSlcclxuICAgICAgICAgICAgICAgIGNvbmZpZ1trZXldID0gYXBwbHlUcmFuc2Zvcm0oa2V5LCBtZXRhLmNvbnRlbnQpO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIGNvbmZpZztcclxufTtcclxuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHN0cmluZyA9PiB7XG5cdGlmICh0eXBlb2Ygc3RyaW5nICE9PSAnc3RyaW5nJykge1xuXHRcdHRocm93IG5ldyBUeXBlRXJyb3IoJ0V4cGVjdGVkIGEgc3RyaW5nJyk7XG5cdH1cblxuXHQvLyBFc2NhcGUgY2hhcmFjdGVycyB3aXRoIHNwZWNpYWwgbWVhbmluZyBlaXRoZXIgaW5zaWRlIG9yIG91dHNpZGUgY2hhcmFjdGVyIHNldHMuXG5cdC8vIFVzZSBhIHNpbXBsZSBiYWNrc2xhc2ggZXNjYXBlIHdoZW4gaXTigJlzIGFsd2F5cyB2YWxpZCwgYW5kIGEgXFx1bm5ubiBlc2NhcGUgd2hlbiB0aGUgc2ltcGxlciBmb3JtIHdvdWxkIGJlIGRpc2FsbG93ZWQgYnkgVW5pY29kZSBwYXR0ZXJuc+KAmSBzdHJpY3RlciBncmFtbWFyLlxuXHRyZXR1cm4gc3RyaW5nXG5cdFx0LnJlcGxhY2UoL1t8XFxcXHt9KClbXFxdXiQrKj8uXS9nLCAnXFxcXCQmJylcblx0XHQucmVwbGFjZSgvLS9nLCAnXFxcXHgyZCcpO1xufTtcbiIsIi8qIVxuICogZXNjYXBlLWh0bWxcbiAqIENvcHlyaWdodChjKSAyMDEyLTIwMTMgVEogSG9sb3dheWNodWtcbiAqIENvcHlyaWdodChjKSAyMDE1IEFuZHJlYXMgTHViYmVcbiAqIENvcHlyaWdodChjKSAyMDE1IFRpYW5jaGVuZyBcIlRpbW90aHlcIiBHdVxuICogTUlUIExpY2Vuc2VkXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIE1vZHVsZSB2YXJpYWJsZXMuXG4gKiBAcHJpdmF0ZVxuICovXG5cbnZhciBtYXRjaEh0bWxSZWdFeHAgPSAvW1wiJyY8Pl0vO1xuXG4vKipcbiAqIE1vZHVsZSBleHBvcnRzLlxuICogQHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZXNjYXBlSHRtbDtcblxuLyoqXG4gKiBFc2NhcGUgc3BlY2lhbCBjaGFyYWN0ZXJzIGluIHRoZSBnaXZlbiBzdHJpbmcgb2YgaHRtbC5cbiAqXG4gKiBAcGFyYW0gIHtzdHJpbmd9IHN0cmluZyBUaGUgc3RyaW5nIHRvIGVzY2FwZSBmb3IgaW5zZXJ0aW5nIGludG8gSFRNTFxuICogQHJldHVybiB7c3RyaW5nfVxuICogQHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIGVzY2FwZUh0bWwoc3RyaW5nKSB7XG4gIHZhciBzdHIgPSAnJyArIHN0cmluZztcbiAgdmFyIG1hdGNoID0gbWF0Y2hIdG1sUmVnRXhwLmV4ZWMoc3RyKTtcblxuICBpZiAoIW1hdGNoKSB7XG4gICAgcmV0dXJuIHN0cjtcbiAgfVxuXG4gIHZhciBlc2NhcGU7XG4gIHZhciBodG1sID0gJyc7XG4gIHZhciBpbmRleCA9IDA7XG4gIHZhciBsYXN0SW5kZXggPSAwO1xuXG4gIGZvciAoaW5kZXggPSBtYXRjaC5pbmRleDsgaW5kZXggPCBzdHIubGVuZ3RoOyBpbmRleCsrKSB7XG4gICAgc3dpdGNoIChzdHIuY2hhckNvZGVBdChpbmRleCkpIHtcbiAgICAgIGNhc2UgMzQ6IC8vIFwiXG4gICAgICAgIGVzY2FwZSA9ICcmcXVvdDsnO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMzg6IC8vICZcbiAgICAgICAgZXNjYXBlID0gJyZhbXA7JztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlIDM5OiAvLyAnXG4gICAgICAgIGVzY2FwZSA9ICcmIzM5Oyc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSA2MDogLy8gPFxuICAgICAgICBlc2NhcGUgPSAnJmx0Oyc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSA2MjogLy8gPlxuICAgICAgICBlc2NhcGUgPSAnJmd0Oyc7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGxhc3RJbmRleCAhPT0gaW5kZXgpIHtcbiAgICAgIGh0bWwgKz0gc3RyLnN1YnN0cmluZyhsYXN0SW5kZXgsIGluZGV4KTtcbiAgICB9XG5cbiAgICBsYXN0SW5kZXggPSBpbmRleCArIDE7XG4gICAgaHRtbCArPSBlc2NhcGU7XG4gIH1cblxuICByZXR1cm4gbGFzdEluZGV4ICE9PSBpbmRleFxuICAgID8gaHRtbCArIHN0ci5zdWJzdHJpbmcobGFzdEluZGV4LCBpbmRleClcbiAgICA6IGh0bWw7XG59XG4iLCJpbXBvcnQgZXNjYXBlUmVnRXhwIGZyb20gJ2VzY2FwZS1zdHJpbmctcmVnZXhwJztcclxuaW1wb3J0IGVzY2FwZUhUTUwgZnJvbSAnZXNjYXBlLWh0bWwnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgKHMsIGRhdGEgPSB7fSkgPT4ge1xyXG4gICAgaWYgKCFzKSByZXR1cm4gcztcclxuXHJcbiAgICBpZiAod2luZG93LkhhbmRsZWJhcnMpXHJcbiAgICAgICAgcmV0dXJuIHdpbmRvdy5IYW5kbGViYXJzLmNvbXBpbGUocykoZGF0YSk7XHJcblxyXG4gICAgZm9yIChsZXQgW2ssIHZdIG9mIE9iamVjdC5lbnRyaWVzKGRhdGEpKVxyXG4gICAgICAgIHMgPSBzLnJlcGxhY2UoXHJcbiAgICAgICAgICAgIG5ldyBSZWdFeHAoYFxcXFwkXFxcXHske2VzY2FwZVJlZ0V4cChTdHJpbmcoaykpfVxcXFx9YCwgJ2cnKSxcclxuICAgICAgICAgICAgZXNjYXBlSFRNTCh2KSxcclxuICAgICAgICApO1xyXG5cclxuICAgIHJldHVybiBzO1xyXG59O1xyXG4iLCJpbXBvcnQge2dldERvY3VtZW50Q29uZmlnfSBmcm9tICdkb2N1bWVudC1jb25maWcnO1xyXG5pbXBvcnQgY29tcGlsZSBmcm9tICcuL2NvbXBpbGUnO1xyXG5cclxuY29uc3QgcHJvcHMgPSBbXHJcbiAgICAnZW5kcG9pbnQnLFxyXG4gICAgJ3RlbXBsYXRlQ29udGFpbmVyJyxcclxuICAgICdjYWNoZU1heEFnZScsXHJcbiAgICAnY2FjaGVTdG9yYWdlJyxcclxuICAgICdjYWNoZU5hbWVzcGFjZScsXHJcbiAgICAnY2FjaGVDYXBhY2l0eScsXHJcbiAgICAndmVyc2lvbicsXHJcbl07XHJcblxyXG5jb25zdCB0cmFuc2Zvcm0gPSB7XHJcbiAgICBjYWNoZU1heEFnZTogTnVtYmVyLFxyXG4gICAgY2FjaGVDYXBhY2l0eTogTnVtYmVyLFxyXG4gICAgY2FjaGVTdG9yYWdlOiB4ID0+IHdpbmRvd1t4XSxcclxufTtcclxuXHJcbmV4cG9ydCBkZWZhdWx0IChjb25maWcgPSB7fSkgPT4ge1xyXG4gICAgY29uc3Qge25zfSA9IGNvbmZpZztcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGNvbXBpbGUsXHJcbiAgICAgICAgdGVtcGxhdGVDb250YWluZXI6ICd0ZW1wbGF0ZScsXHJcbiAgICAgICAgY2FjaGVOYW1lc3BhY2U6IG5zLFxyXG4gICAgICAgIC4uLmdldERvY3VtZW50Q29uZmlnKHtucywgcHJvcHMsIHRyYW5zZm9ybX0pLFxyXG4gICAgICAgIC4uLmNvbmZpZyxcclxuICAgIH07XHJcbn07XHJcbiIsImFzeW5jIGZ1bmN0aW9uIHJlc29sdmUocmVzcG9uc2UpIHtcclxuICAgIGxldCB7b2ssIGhlYWRlcnMsIHN0YXR1cywgc3RhdHVzVGV4dH0gPSByZXNwb25zZTtcclxuICAgIGxldCBvdXRwdXQgPSB7c3RhdHVzLCBzdGF0dXNUZXh0LCBoZWFkZXJzfTtcclxuXHJcbiAgICBpZiAob2spIHtcclxuICAgICAgICBvdXRwdXQuZGF0YSA9IGF3YWl0IHJlc3BvbnNlLnRleHQoKTtcclxuICAgICAgICByZXR1cm4gb3V0cHV0O1xyXG4gICAgfVxyXG4gICAgZWxzZSB0aHJvdyBuZXcgRXJyb3Iob3V0cHV0KTtcclxufVxyXG5cclxuZXhwb3J0IGRlZmF1bHQgKHsgYmFzZVVSTCB9KSA9PiB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGdldDogYXN5bmMgcGF0aCA9PiB7XHJcbiAgICAgICAgICAgIGxldCByZXNwb25zZSA9IGF3YWl0IGZldGNoKGJhc2VVUkwgKyBwYXRoKTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiBhd2FpdCByZXNvbHZlKHJlc3BvbnNlKTtcclxuICAgICAgICB9LFxyXG4gICAgICAgIHBvc3Q6IGFzeW5jIChwYXRoLCBvcHRpb25zID0ge30pID0+IHtcclxuICAgICAgICAgICAgbGV0IHJlc3BvbnNlID0gYXdhaXQgZmV0Y2goYmFzZVVSTCArIHBhdGgsIHtcclxuICAgICAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxyXG4gICAgICAgICAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkob3B0aW9ucy5kYXRhIHx8IHt9KSxcclxuICAgICAgICAgICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxyXG4gICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4gYXdhaXQgcmVzb2x2ZShyZXNwb25zZSk7XHJcbiAgICAgICAgfSxcclxuICAgIH07XHJcbn07XHJcbiIsImltcG9ydCBWb2xhdGlsZVN0b3JhZ2UgZnJvbSAndm9sYXRpbGUtc3RvcmFnZSc7XHJcbmltcG9ydCBidWlsZENvbmZpZyBmcm9tICcuLi9saWIvYnVpbGRDb25maWcnO1xyXG5pbXBvcnQgY3JlYXRlQVBJQ2xpZW50IGZyb20gJy4uL2xpYi9jcmVhdGVBUElDbGllbnQnO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgY29uZmlnID0+IHtcclxuICAgIGNvbnN0IHtcclxuICAgICAgICBlbmRwb2ludCxcclxuICAgICAgICB0ZW1wbGF0ZUNvbnRhaW5lcixcclxuICAgICAgICBjb21waWxlLFxyXG4gICAgICAgIG9uRXJyb3IsXHJcbiAgICAgICAgY2FjaGVNYXhBZ2UsXHJcbiAgICAgICAgY2FjaGVDYXBhY2l0eSxcclxuICAgICAgICBjYWNoZVN0b3JhZ2UsXHJcbiAgICAgICAgY2FjaGVOYW1lc3BhY2UsXHJcbiAgICAgICAgdmVyc2lvbixcclxuICAgIH0gPSBidWlsZENvbmZpZyhjb25maWcpO1xyXG5cclxuICAgIGxldCBhcGksIGNhY2hlO1xyXG5cclxuICAgIGlmIChlbmRwb2ludCkge1xyXG4gICAgICAgIGNhY2hlID0gbmV3IFZvbGF0aWxlU3RvcmFnZSh7XHJcbiAgICAgICAgICAgIG1heEFnZTogY2FjaGVNYXhBZ2UsXHJcbiAgICAgICAgICAgIGNhcGFjaXR5OiBjYWNoZUNhcGFjaXR5LFxyXG4gICAgICAgICAgICBzdG9yYWdlOiBjYWNoZVN0b3JhZ2UsXHJcbiAgICAgICAgICAgIG5zOiBjYWNoZU5hbWVzcGFjZSxcclxuICAgICAgICAgICAgdmVyc2lvbixcclxuICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgYXBpID0gY3JlYXRlQVBJQ2xpZW50KHtcclxuICAgICAgICAgICAgYmFzZVVSTDogZW5kcG9pbnQsXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGFzeW5jIChlbGVtZW50TmFtZSwgZGF0YSwgc2VydmVyU2lkZVRlbXBsYXRlUmVuZGVyaW5nID0gZmFsc2UpID0+IHtcclxuICAgICAgICBsZXQgaW5uZXJIVE1MO1xyXG5cclxuICAgICAgICBpZiAoc2VydmVyU2lkZVRlbXBsYXRlUmVuZGVyaW5nICYmIGFwaSkge1xyXG4gICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgbGV0IHJlc3BvbnNlID0gYXdhaXQgYXBpLnBvc3QoZWxlbWVudE5hbWUsIHtkYXRhfSk7XHJcbiAgICAgICAgICAgICAgICBpbm5lckhUTUwgPSByZXNwb25zZS5kYXRhO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIGNhdGNoKGUpIHtcclxuICAgICAgICAgICAgICAgIGlmIChvbkVycm9yKSBvbkVycm9yKGUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgICBsZXQgcywgdG1wbEVsZW1lbnQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKFxyXG4gICAgICAgICAgICAgICAgYCR7dGVtcGxhdGVDb250YWluZXJ9W2RhdGEtZWxlbWVudD1cIiR7ZWxlbWVudE5hbWV9XCJdYFxyXG4gICAgICAgICAgICApO1xyXG5cclxuICAgICAgICAgICAgaWYgKHRtcGxFbGVtZW50KVxyXG4gICAgICAgICAgICAgICAgcyA9IHRtcGxFbGVtZW50LmlubmVySFRNTDtcclxuICAgICAgICAgICAgZWxzZSBpZiAoYXBpKSB7XHJcbiAgICAgICAgICAgICAgICBzID0gYXdhaXQgY2FjaGUuZ2V0SXRlbShlbGVtZW50TmFtZSk7XHJcblxyXG4gICAgICAgICAgICAgICAgaWYgKCFzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbGV0IHJlc3BvbnNlID0gYXdhaXQgYXBpLmdldChlbGVtZW50TmFtZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGNhY2hlLnNldEl0ZW0oZWxlbWVudE5hbWUsIHMgPSByZXNwb25zZS5kYXRhKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgY2F0Y2goZSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAob25FcnJvcikgb25FcnJvcihlKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIGlubmVySFRNTCA9IGNvbXBpbGUocywgZGF0YSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBsZXQgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XHJcblxyXG4gICAgICAgIGlmIChpbm5lckhUTUwpIHtcclxuICAgICAgICAgICAgbGV0IGJ1ZmZlciA9IE9iamVjdC5hc3NpZ24oZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYm9keScpLCB7aW5uZXJIVE1MfSk7XHJcblxyXG4gICAgICAgICAgICB3aGlsZSAoYnVmZmVyLmNoaWxkTm9kZXMubGVuZ3RoKVxyXG4gICAgICAgICAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoYnVmZmVyLmZpcnN0Q2hpbGQpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcmV0dXJuIGZyYWdtZW50O1xyXG4gICAgfTtcclxufTtcclxuIiwiaW1wb3J0IGZhY3RvcnkgZnJvbSAnLi9zcmMvY3JlYXRlRWxlbWVudCc7XHJcblxyXG5jb25zdCBjcmVhdGVFbGVtZW50ID0gZmFjdG9yeSgpO1xyXG5cclxuZXhwb3J0IHtmYWN0b3J5LCBjcmVhdGVFbGVtZW50fTtcclxuIiwiaW1wb3J0IHtnZXREb2N1bWVudENvbmZpZ30gZnJvbSAnZG9jdW1lbnQtY29uZmlnJztcclxuXHJcbmNvbnN0IERFRkFVTFRfTlMgPSAneGpzJztcclxuY29uc3QgcHJvcHMgPSBbJ2Jhc2VSb3V0ZSddO1xyXG5cclxuZXhwb3J0IGRlZmF1bHQgKGNvbmZpZyA9IHt9KSA9PiB7XHJcbiAgICBjb25zdCB7bnMgPSBERUZBVUxUX05TfSA9IGNvbmZpZztcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIG5zLFxyXG4gICAgICAgIC4uLmdldERvY3VtZW50Q29uZmlnKHtucywgcHJvcHN9KSxcclxuICAgICAgICAuLi5jb25maWcsXHJcbiAgICB9O1xyXG59O1xyXG4iLCJleHBvcnQgZGVmYXVsdCAoY29uZmlnLCBzdWJOUykgPT4ge1xyXG4gICAgY29uc3QgbnMgPSBjb25maWcgJiYgY29uZmlnLm5zO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgICAgLi4uY29uZmlnLFxyXG4gICAgICAgIG5zOiAobnMgPyBucyArICcuJyA6ICcnKSArIHN1Yk5TLFxyXG4gICAgfTtcclxufTtcclxuIiwiZXhwb3J0IGRlZmF1bHQgKGVsZW1lbnQsIGNvbnRlbnQpID0+IHtcclxuICAgIGlmICh0eXBlb2YgY29udGVudCA9PT0gJ3N0cmluZycpXHJcbiAgICAgICAgZWxlbWVudC5pbm5lckhUTUwgPSBjb250ZW50O1xyXG4gICAgZWxzZSB7XHJcbiAgICAgICAgZWxlbWVudC5pbm5lckhUTUwgPSAnJztcclxuICAgICAgICBpZiAoY29udGVudCkgZWxlbWVudC5hcHBlbmRDaGlsZChjb250ZW50KTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gZWxlbWVudDtcclxufTtcclxuIiwiaW1wb3J0IEV2ZW50TWFuYWdlciBmcm9tICdldmVudC1tYW5hZ2VyJztcclxuaW1wb3J0IHtwcm94eVNlbGVjdG9yLCBwcm94eVNlbGVjdG9yQWxsfSBmcm9tICdwcm94eS1lbGVtZW50JztcclxuaW1wb3J0IHtyb3V0ZSwgUm91dGVyfSBmcm9tICdyb3V0ZXInO1xyXG5pbXBvcnQge2ltcG9ydFNjcmlwdCwgaW1wb3J0U3R5bGUsIGltcG9ydFJlc291cmNlfSBmcm9tICdpbXBvcnQtcmVzb3VyY2UnO1xyXG5pbXBvcnQge2ZhY3RvcnkgYXMgY3JlYXRlRWxlbWVudH0gZnJvbSAnY3JlYXRlLWVsZW1lbnQnO1xyXG5pbXBvcnQgYnVpbGRDb25maWcgZnJvbSAnLi9saWIvYnVpbGRDb25maWcnO1xyXG5pbXBvcnQgd2l0aE5lc3RlZE5TIGZyb20gJy4vbGliL3dpdGhOZXN0ZWROUyc7XHJcbmltcG9ydCByZXBsYWNlQ29udGVudCBmcm9tICcuL2xpYi9yZXBsYWNlQ29udGVudCc7XHJcblxyXG5jb25zdCBjcmVhdGUgPSAoY29uZmlnID0ge30pID0+IHtcclxuICAgIGNvbmZpZyA9IGJ1aWxkQ29uZmlnKGNvbmZpZyk7XHJcblxyXG4gICAgY29uc3QgbWVkaWF0b3IgPSBuZXcgRXZlbnRNYW5hZ2VyKCk7XHJcbiAgICBjb25zdCByb3V0ZXIgPSBuZXcgUm91dGVyKHtiYXNlUm91dGU6IGNvbmZpZy5iYXNlUm91dGV9KTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICAgIGFkZEV2ZW50TGlzdGVuZXI6IChlLCBmKSA9PiBtZWRpYXRvci5hZGRFdmVudExpc3RlbmVyKGUsIGYpLFxyXG4gICAgICAgIGFkZFJvdXRlTGlzdGVuZXI6IChyLCBmKSA9PiByb3V0ZXIuYWRkUm91dGVMaXN0ZW5lcihyLCBmKSxcclxuICAgICAgICBjb25maWcsXHJcbiAgICAgICAgY3JlYXRlRWxlbWVudDogY3JlYXRlRWxlbWVudCh3aXRoTmVzdGVkTlMoY29uZmlnLCAnZWxlbWVudCcpKSxcclxuICAgICAgICBkaXNwYXRjaEV2ZW50OiAoZSwgcCkgPT4gbWVkaWF0b3IuZGlzcGF0Y2hFdmVudChlLCBwKSxcclxuICAgICAgICBkaXNwYXRjaFJvdXRlOiBwYXRoID0+IHJvdXRlci5kaXNwYXRjaFJvdXRlKHBhdGgpLFxyXG4gICAgICAgIGltcG9ydFJlc291cmNlLFxyXG4gICAgICAgIGltcG9ydFNjcmlwdCxcclxuICAgICAgICBpbXBvcnRTdHlsZSxcclxuICAgICAgICBwcm94eVNlbGVjdG9yLFxyXG4gICAgICAgIHByb3h5U2VsZWN0b3JBbGwsXHJcbiAgICAgICAgcmVtb3ZlRXZlbnRMaXN0ZW5lcjogKGUsIGYpID0+IG1lZGlhdG9yLnJlbW92ZUV2ZW50TGlzdGVuZXIoZSwgZiksXHJcbiAgICAgICAgcmVtb3ZlUm91dGVMaXN0ZW5lcjogKHIsIGYpID0+IHJvdXRlci5yZW1vdmVSb3V0ZUxpc3RlbmVyKHIsIGYpLFxyXG4gICAgICAgIHJlcGxhY2VDb250ZW50LFxyXG4gICAgICAgIHJvdXRlLFxyXG4gICAgICAgIFJvdXRlcixcclxuICAgIH07XHJcbn07XHJcblxyXG5leHBvcnQgZGVmYXVsdCB7Y3JlYXRlLCAuLi5jcmVhdGUoKX07XHJcbiJdLCJuYW1lcyI6WyJNZW1vcnlTdG9yYWdlIiwiZXNjYXBlUmVnRXhwIiwiZXNjYXBlSFRNTCIsIlZvbGF0aWxlU3RvcmFnZSIsImNyZWF0ZUVsZW1lbnQiLCJmYWN0b3J5IiwicHJvcHMiLCJidWlsZENvbmZpZyJdLCJtYXBwaW5ncyI6Ijs7O0lBQUEsTUFBTSxZQUFZLENBQUM7SUFDbkIsSUFBSSxXQUFXLENBQUMsS0FBSyxHQUFHLEVBQUUsRUFBRTtJQUM1QixRQUFRLElBQUksQ0FBQyxrQkFBa0IsR0FBRyxLQUFLLENBQUMsa0JBQWtCO0lBQzFELFlBQVksS0FBSyxDQUFDLGtCQUFrQixDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDL0MsYUFBYSxDQUFDLFFBQVEsRUFBRSxLQUFLLEtBQUssUUFBUSxDQUFDLElBQUksS0FBSyxHQUFHLElBQUksUUFBUSxDQUFDLElBQUksS0FBSyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7QUFDekY7SUFDQSxRQUFRLElBQUksQ0FBQyxnQkFBZ0IsR0FBRyxLQUFLLENBQUMsZ0JBQWdCO0lBQ3RELFlBQVksS0FBSyxDQUFDLGdCQUFnQixDQUFD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
