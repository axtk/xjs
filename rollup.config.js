import babel  from '@rollup/plugin-babel';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import json from '@rollup/plugin-json';
import commonjs from '@rollup/plugin-commonjs';
import {terser} from 'rollup-plugin-terser';
import sizeDiff from 'rollup-plugin-sizediff';

const {NODE_ENV = 'production', BUILD_MODE} = process.env;

let suffix = [BUILD_MODE, NODE_ENV !== 'production' && NODE_ENV]
	.filter(Boolean)
	.map(x => '.' + x)
	.join('');

export default {
    input: './index.js',
    output: {
    	name: require('./package.json').name,
        file: `./build/xjs${suffix}.js`,
        format: 'iife',
        sourcemap: NODE_ENV !== 'production' && 'inline',
    },
    plugins: [
        nodeResolve(),
        json(),
        commonjs(),
        BUILD_MODE === 'legacy' && babel({babelHelpers: 'bundled'}),
        NODE_ENV === 'production' && terser(),
        sizeDiff(),
    ],
};
