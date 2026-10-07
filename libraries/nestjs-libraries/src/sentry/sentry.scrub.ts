// Scrubbing applied to everything the backend and orchestrator send to Sentry.
// Pure functions, so they can be tested without initialising the SDK.

export const REDACTED = '[redacted]';

// The MCP / SSE transports carry the organisation's API key as a path segment.
const KEY_PATH = /(\/(?:mcp|sse|message)\/)[^/?#\s"'<>]+/gi;

// Query values that are credentials or one-time codes.
const SECRET_PARAMS =
  'loggedAuth|token|code|state|apiKey|api_key|access_token|refresh_token';
const SECRET_QUERY = new RegExp(
  `([?&;](?:${SECRET_PARAMS})=)[^&#\\s"'<>]*`,
  'gi'
);
const SECRET_PARAM_NAME = new RegExp(`^(?:${SECRET_PARAMS})$`, 'i');

const SECRET_HEADERS = new Set([
  'auth',
  'authorization',
  'cookie',
  'set-cookie',
  'impersonate',
  'proxy-authorization',
  'x-api-key',
]);

// Request bodies on these paths are credentials, OAuth codes or provisioning
// secrets; they are never sent.
const SECRET_BODY_PATHS = [
  /\/auth\//i,
  /\/integrations\/social-connect/i,
  /\/public\/provision/i,
];

export const redactUrl = <T>(value: T): T => {
  if (typeof value !== 'string' || !value) {
    return value;
  }

  return value
    .replace(KEY_PATH, `$1${REDACTED}`)
    .replace(SECRET_QUERY, `$1${REDACTED}`) as unknown as T;
};

const redactStringsIn = (record: any): any => {
  if (!record || typeof record !== 'object') {
    return record;
  }

  for (const key of Object.keys(record)) {
    if (typeof record[key] === 'string') {
      record[key] = redactUrl(record[key]);
    }
  }

  return record;
};

export const redactHeaders = (headers: any): any => {
  if (!headers || typeof headers !== 'object') {
    return headers;
  }

  for (const key of Object.keys(headers)) {
    if (SECRET_HEADERS.has(key.toLowerCase())) {
      headers[key] = REDACTED;
    } else if (typeof headers[key] === 'string') {
      headers[key] = redactUrl(headers[key]);
    }
  }

  return headers;
};

const redactQuery = (query: any): any => {
  if (typeof query === 'string') {
    // A bare query string has no leading "?", so give it one for the regexp.
    return redactUrl(`?${query}`).slice(1);
  }

  if (Array.isArray(query)) {
    return query.map((pair) =>
      Array.isArray(pair) && SECRET_PARAM_NAME.test(String(pair[0]))
        ? [pair[0], REDACTED]
        : pair
    );
  }

  if (query && typeof query === 'object') {
    for (const key of Object.keys(query)) {
      if (SECRET_PARAM_NAME.test(key)) {
        query[key] = REDACTED;
      }
    }
  }

  return query;
};

export const redactRequest = (request: any): any => {
  if (!request || typeof request !== 'object') {
    return request;
  }

  const originalUrl = typeof request.url === 'string' ? request.url : '';

  if (request.url) {
    request.url = redactUrl(request.url);
  }

  if (request.query_string) {
    request.query_string = redactQuery(request.query_string);
  }

  if (request.headers) {
    request.headers = redactHeaders(request.headers);
  }

  if (request.cookies) {
    request.cookies = REDACTED;
  }

  if (
    request.data !== undefined &&
    SECRET_BODY_PATHS.some((path) => path.test(originalUrl))
  ) {
    request.data = REDACTED;
  }

  return request;
};

export const redactBreadcrumb = <T extends Record<string, any>>(
  breadcrumb: T
): T => {
  if (!breadcrumb) {
    return breadcrumb;
  }

  if (typeof breadcrumb.message === 'string') {
    (breadcrumb as any).message = redactUrl(breadcrumb.message);
  }

  if (breadcrumb.data) {
    redactStringsIn(breadcrumb.data);
  }

  return breadcrumb;
};

export const redactEvent = <T extends Record<string, any>>(event: T): T => {
  if (!event) {
    return event;
  }

  const e: any = event;

  if (e.request) {
    redactRequest(e.request);
  }

  if (typeof e.transaction === 'string') {
    e.transaction = redactUrl(e.transaction);
  }

  if (typeof e.message === 'string') {
    e.message = redactUrl(e.message);
  }

  for (const value of e.exception?.values || []) {
    if (typeof value?.value === 'string') {
      value.value = redactUrl(value.value);
    }
  }

  for (const breadcrumb of e.breadcrumbs || []) {
    redactBreadcrumb(breadcrumb);
  }

  if (e.contexts?.trace?.data) {
    redactStringsIn(e.contexts.trace.data);
  }

  for (const span of e.spans || []) {
    if (typeof span?.description === 'string') {
      span.description = redactUrl(span.description);
    }
    if (span?.data) {
      redactStringsIn(span.data);
    }
  }

  return event;
};

export const redactLog = <T extends Record<string, any>>(log: T): T => {
  if (!log) {
    return log;
  }

  if (typeof log.message === 'string') {
    (log as any).message = redactUrl(log.message);
  }

  if (log.attributes) {
    redactStringsIn(log.attributes);
  }

  return log;
};
