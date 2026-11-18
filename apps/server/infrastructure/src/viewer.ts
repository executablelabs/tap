export function viewerFunctionCode(hostname: string, redirectHosts: string[]) {
  const code = `function handler(event) {
  var request = event.request;
  var canonical = ${JSON.stringify(hostname)};
  var redirects = ${JSON.stringify(redirectHosts)};
  var host = (request.headers.host || {}).value || '';
  if (redirects.indexOf(host) !== -1) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return {statusCode: 421, headers: {'cache-control': {value: 'no-store'}}};
    var query = request.querystring || {}, parts = [];
    Object.keys(query).forEach(function(key) {
      var item = query[key], values = item.multiValue && item.multiValue.length ? item.multiValue : [item];
      values.forEach(function(value) { parts.push(key + '=' + value.value); });
    });
    return {statusCode: 308, headers: {location: {value: 'https://' + canonical + request.uri + (parts.length ? '?' + parts.join('&') : '')}, 'cache-control': {value: 'no-store'}}};
  }
  if (host !== canonical && !/^[a-z0-9]+\\.cloudfront\\.net$/.test(host)) return {statusCode: 403, headers: {'cache-control': {value: 'no-store'}}};
  request.headers['x-forwarded-host'] = {value: canonical};
  return request;
}`;
  if (Buffer.byteLength(code) > 10240) throw new Error("CloudFront Function exceeds 10 KB");
  return code;
}
