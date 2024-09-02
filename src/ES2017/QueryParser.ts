
var qs = require('qs');

/**
 * FORK From https://github.com/restify/node-restify/blob/009f40b31612940edd196319178c574e49c85bb8/lib/plugins/query.js
 * to include allowSparse option available in latest `qs` package
 * 
 * Parses the HTTP query string (i.e., `/foo?id=bar&name=mark`).
 * If you use this, the parsed content will always be available in `req.query`,
 * additionally params are merged into `req.params`.
 * You can disable by passing in `mapParams: false` in the options object.
 *
 * Many options correspond directly to option defined for the underlying
 * [`qs.parse`](https://github.com/ljharb/qs).
 *
 * @public
 * @function queryParser
 * @param    {Object}   [options] - an options object
 * @param    {Object}   [options.mapParams=true] - disable passing
 * @param {Boolean} [options.mapParams=false] - Copies parsed query parameters
 * into`req.params`.
 * @param {Boolean} [options.overrideParams=false] - Only applies when if
 * mapParams true.
 * When true, will stomp on req.params field when existing value is found.
 * @param {Boolean} [options.allowDots=false] - Transform `?foo.bar=baz` to a
 * nested object: `{foo: {bar: 'baz'}}`.
 * @param {Boolean} [options.allowSparse=false] - Transform `?a[1]=2&a[3]=5` to a
 * nested object: `{a: [, '2', , '5']}`.
 * @param {Number} [options.arrayLimit=20] - Only transform `?a[$index]=b`
 * to an array if `$index` is less than `arrayLimit`.
 * @param {Number} [options.depth=5] - The depth limit for parsing
 * nested objects, e.g. `?a[b][c][d][e][f][g][h][i]=j`.
 * @param {Number} [options.parameterLimit=1000] - Maximum number of query
 * params parsed. Additional params are silently dropped.
 * @param {Boolean} [options.parseArrays=true] - Whether to parse
 * `?a[]=b&a[1]=c` to an array, e.g. `{a: ['b', 'c']}`.
 * @param {Boolean} [options.plainObjects=false] - Whether `req.query` is a
 * "plain" object -- does not inherit from `Object`.
 * This can be used to allow query params whose names collide with Object
 * methods, e.g. `?hasOwnProperty=blah`.
 * @param {Boolean} [options.strictNullHandling=false] - If true, `?a&b=`
 * results in `{a: null, b: ''}`. Otherwise, `{a: '', b: ''}`.
 * @returns  {Function} Handler
 * @example
 * server.use(restify.plugins.queryParser({ mapParams: false }));
 */
export function queryParser(options) {
    var opts = options || {};

    function parseQueryString(req, res, next) {
        if (!req.getQuery()) {
            req.query = {};
            return next();
        }

        req.query = qs.parse(req.getQuery(), opts);

        if (opts.mapParams === true) {
            Object.keys(req.query).forEach(function forEach(k) {
                if (req.params[k] && !opts.overrideParams) {
                    return;
                }
                req.params[k] = req.query[k];
            });
        }

        return next();
    }

    return parseQueryString;
}
