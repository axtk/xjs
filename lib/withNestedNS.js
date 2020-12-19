export default (config, subNS) => {
    const ns = config && config.ns;

    return {
        ...config,
        ns: (ns ? ns + '.' : '') + subNS,
    };
};
