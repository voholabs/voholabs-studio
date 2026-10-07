import { Readable } from 'stream';
import { isSafePublicUrl } from './webhook.url.validator';
import { getSsrfSafeDispatcher, ssrfSafeDispatcher } from './ssrf.safe.dispatcher';

export class SafeFetchError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

export interface SafeFetchOptions {
  /** Abort after this many ms. Default 15 000. */
  timeoutMs?: number;
  /**
   * When true (default) the timeout also covers reading the body. Set false
   * for long-running streams where only the time to first response should be
   * bounded; the caller then owns cancellation through `init.signal`.
   */
  timeoutCoversBody?: boolean;
  /** Fail when the body grows past this many bytes. */
  maxBytes?: number;
  /**
   * Accepted response media types, matched as lower-cased prefixes of the
   * Content-Type (e.g. 'text/html', 'video/'). A missing Content-Type counts
   * as 'application/octet-stream'.
   */
  allowedContentTypes?: string[];
  /** Accept http:// as well as https://. Default false. */
  allowHttp?: boolean;
  /** Redirect hops to follow; each target is validated again. Default 3. */
  maxRedirects?: number;
  /**
   * Keep the private-network guard on even when DISABLE_SSRF_PROTECTION is
   * set. Use for endpoints anyone can call without signing in.
   */
  ignoreOptOut?: boolean;
}

const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

function capBody(
  res: Response,
  maxBytes: number,
  onExceeded: () => void
): Response {
  if (!res.body || NULL_BODY_STATUSES.has(res.status)) return res;

  let total = 0;
  const capped = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          onExceeded();
          controller.error(new SafeFetchError('Response too large', 413));
          return;
        }
        controller.enqueue(chunk);
      },
    })
  );

  return new Response(capped, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

function mediaType(res: Response): string {
  return (
    (res.headers.get('content-type') || 'application/octet-stream')
      .split(';')[0]
      .trim()
      .toLowerCase()
  );
}

/**
 * The one way to fetch a URL that came from a user, an organisation's
 * settings, or fetched content. It
 *  - checks the URL is http(s) on a public host (every redirect hop too),
 *  - connects through the SSRF-safe dispatcher, which also refuses IP
 *    literals and DNS answers in private ranges at connect time,
 *  - aborts after `timeoutMs`,
 *  - optionally limits the response size and media type.
 *
 * Redirects are followed by hand so each Location is re-validated and the
 * hop count is bounded. Method/body handling mirrors fetch: 303, and 301/302
 * on POST, continue as GET without a body; 307/308 resend the same request.
 *
 * Throws SafeFetchError (with an HTTP-ish status) for anything it refuses.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<Response> {
  const {
    timeoutMs = 15_000,
    timeoutCoversBody = true,
    maxBytes,
    allowedContentTypes,
    allowHttp = false,
    maxRedirects = 3,
    ignoreOptOut = false,
  } = options;

  const optedOut =
    !ignoreOptOut && process.env.DISABLE_SSRF_PROTECTION === 'true';
  const dispatcher = ignoreOptOut ? ssrfSafeDispatcher : getSsrfSafeDispatcher();

  const timeoutController = new AbortController();
  const timer = setTimeout(
    () => timeoutController.abort(new SafeFetchError('Request timed out', 504)),
    timeoutMs
  );
  (timer as any).unref?.();
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutController.signal])
    : timeoutController.signal;

  const stopTimer = () => clearTimeout(timer);

  try {
    let currentUrl = url;
    let method = (init.method || 'GET').toUpperCase();
    let body = init.body;

    for (let hop = 0; ; hop++) {
      const urlOk = optedOut
        ? /^https?:$/.test(safeProtocol(currentUrl)) &&
          (allowHttp || safeProtocol(currentUrl) === 'https:')
        : await isSafePublicUrl(currentUrl, { allowHttp });
      if (!urlOk) {
        throw new SafeFetchError('Blocked URL', 400);
      }

      const res = await fetch(currentUrl, {
        ...init,
        method,
        body,
        signal,
        redirect: 'manual',
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher,
      });

      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const location = res.headers.get('location');
        if (!location) {
          return finish(res);
        }
        await res.body?.cancel().catch(() => undefined);
        if (hop >= maxRedirects) {
          throw new SafeFetchError('Too many redirects', 508);
        }
        try {
          currentUrl = new URL(location, currentUrl).toString();
        } catch {
          throw new SafeFetchError('Invalid redirect target', 502);
        }
        if (
          res.status === 303 ||
          ((res.status === 301 || res.status === 302) && method === 'POST')
        ) {
          if (method !== 'HEAD') method = 'GET';
          body = undefined;
        }
        continue;
      }

      return finish(res);
    }
  } catch (err) {
    stopTimer();
    if (err instanceof SafeFetchError) throw err;
    if (timeoutController.signal.aborted) {
      throw new SafeFetchError('Request timed out', 504);
    }
    throw err;
  }

  function finish(res: Response): Response {
    if (allowedContentTypes?.length) {
      const type = mediaType(res);
      if (!allowedContentTypes.some((allowed) => type.startsWith(allowed))) {
        res.body?.cancel().catch(() => undefined);
        stopTimer();
        throw new SafeFetchError('Unsupported content type', 415);
      }
    }

    if (maxBytes !== undefined) {
      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.body?.cancel().catch(() => undefined);
        stopTimer();
        throw new SafeFetchError('Response too large', 413);
      }
    }

    if (!timeoutCoversBody) {
      stopTimer();
    }

    let out = res;
    if (maxBytes !== undefined) {
      out = capBody(res, maxBytes, () => timeoutController.abort());
    }
    if (timeoutCoversBody) {
      if (!out.body) {
        stopTimer();
      } else {
        out = new Response(
          out.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              flush: stopTimer,
            })
          ),
          { status: out.status, statusText: out.statusText, headers: out.headers }
        );
      }
    }
    return out;
  }
}

function safeProtocol(url: string): string {
  try {
    return new URL(url).protocol;
  } catch {
    return '';
  }
}

/** safeFetch + read the body as text (size cap applies while reading). */
export async function safeFetchText(
  url: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<{ response: Response; text: string }> {
  const response = await safeFetch(url, init, options);
  const text = await response.text();
  return { response, text };
}

/**
 * Options for downloading post media (images, videos) from a URL a client
 * supplied: http or https, 5 min, up to 1 GB, at most 3 redirects.
 */
export const MEDIA_FETCH_OPTIONS: SafeFetchOptions = {
  allowHttp: true,
  timeoutMs: 300_000,
  maxBytes: 1024 * 1024 * 1024,
  maxRedirects: 3,
};

/** safeFetch with MEDIA_FETCH_OPTIONS. Returns the response as-is. */
export function safeFetchMedia(
  url: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<Response> {
  return safeFetch(url, init, { ...MEDIA_FETCH_OPTIONS, ...options });
}

/** Download media into a Buffer. Like axios, a non-2xx answer is an error. */
export async function safeFetchBuffer(
  url: string,
  options: SafeFetchOptions = {}
): Promise<Buffer> {
  const response = await safeFetchMedia(url, {}, options);
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeFetchError(
      `Failed to download media: ${response.status}`,
      response.status
    );
  }
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Download media as a Node stream, for callers that pipe it into an upload.
 * The timeout bounds the time to the response only, since the consumer reads
 * the body at its own pace; the size cap still applies while it is read.
 * `contentLength` is set only when the body is not content-encoded, so it is
 * the length of the bytes the stream yields.
 */
export async function safeFetchStream(
  url: string,
  options: SafeFetchOptions = {}
): Promise<{
  stream: Readable;
  contentLength?: number;
  contentType?: string;
}> {
  const response = await safeFetchMedia(
    url,
    {},
    { timeoutCoversBody: false, ...options }
  );
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeFetchError(
      `Failed to download media: ${response.status}`,
      response.ok ? 502 : response.status
    );
  }

  const encoding = (response.headers.get('content-encoding') || 'identity')
    .trim()
    .toLowerCase();
  const rawLength = response.headers.get('content-length');
  const declared = Number(rawLength);
  const contentLength =
    encoding === 'identity' &&
    rawLength !== null &&
    Number.isFinite(declared) &&
    declared >= 0
      ? declared
      : undefined;

  return {
    stream: Readable.fromWeb(response.body as any),
    contentLength,
    contentType: response.headers.get('content-type') || undefined,
  };
}
