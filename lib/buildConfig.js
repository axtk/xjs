import {getDocumentConfig} from 'document-config';

const DEFAULT_NS = 'xjs';
const props = ['baseRoute'];

export default (config = {}) => {
    const {ns = DEFAULT_NS} = config;

    return {
        ns,
        ...getDocumentConfig({ns, props}),
        ...config,
    };
};
