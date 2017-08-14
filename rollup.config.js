// rollup.config.js
import resolve from 'rollup-plugin-node-resolve'
import commonjs from 'rollup-plugin-commonjs'
import babel from 'rollup-plugin-babel'
import builtins from 'rollup-plugin-node-builtins'
import uglify from 'rollup-plugin-uglify'

export default {
    entry: 'src/zip-parse.js',
    dest: 'bin/zip-parse.js',
    moduleName: 'zipParse',
    format: 'cjs',
    external: ['path', 'zlib', 'assert', 'process', 'module', 'fs'],
    plugins: [
        babel(),
        resolve({
            jsnext: true,
            main: true,
            preferBuiltins: false
        }),
        builtins(),
        commonjs(),
        uglify()
    ]
}