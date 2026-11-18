import { context, diag } from "@opentelemetry/api";
import { ATTR_URL_FULL } from "@opentelemetry/semantic-conventions";
import { suppressTracing } from "@opentelemetry/core";
// src/internal/endpoints.ts
const SIGNAL_PATH = /\/v1\/(?:traces|logs)\/*$/;
/**
* Resolves a collector URL to an absolute http(s) URL.
*
* @remarks
* A relative value, such as a same-origin proxy path, resolves against the page URL, because the
* upstream SDK accepts only absolute URLs.
*
* @param url - The URL from the options.
* @returns The absolute URL, or `undefined` when `url` is empty, unparsable or not http(s).
* @internal
*/
function resolveUrl(url) {
	if (!url) return;
	try {
		const resolved = new URL(url, location.href);
		if (resolved.protocol !== "http:" && resolved.protocol !== "https:") return;
		resolved.hash = "";
		return resolved;
	} catch {
		return;
	}
}
/**
* Builds the OTLP/HTTP URL of one signal from the collector base URL.
*
* @remarks
* `/v1/traces` or `/v1/logs` is appended to the path, as for `OTEL_EXPORTER_OTLP_ENDPOINT`, after
* dropping a `/v1/traces` or `/v1/logs` the endpoint already ends with.
*
* @param endpoint - The collector base URL.
* @param signal - The signal whose path is appended.
* @returns The absolute URL, or `undefined` when `endpoint` is empty, unparsable or not http(s).
* @internal
*/
function signalUrl(endpoint, signal) {
	const url = resolveUrl(endpoint);
	if (url === void 0) return;
	url.pathname = `${url.pathname.replace(SIGNAL_PATH, "").replace(/\/+$/, "")}/v1/${signal}`;
	return url.href;
}
/**
* Whether an endpoint already ends with `/v1/traces` or `/v1/logs`, which {@link signalUrl} drops.
*
* @param endpoint - The collector base URL.
* @returns `true` for an endpoint such as `https://collector/v1/traces`.
* @internal
*/
function hasSignalPath(endpoint) {
	const url = resolveUrl(endpoint);
	return url !== void 0 && SIGNAL_PATH.test(url.pathname);
}
// src/internal/global.ts
const KEY = Symbol.for("@clickhouse/clickstack-browser");
/**
* Returns the page-wide flags, creating them on first use.
*
* @returns The flags object stored on `globalThis`.
* @internal
*/
function pageState() {
	const holder = globalThis;
	return holder[KEY] ??= {};
}
// src/internal/transport.ts
const TIMEOUT_MS = 1e4;
const KEEPALIVE_MAX_BYTES = 61440;
const KEEPALIVE_MAX_REQUESTS = 9;
let keepaliveBytes = 0;
let keepaliveRequests = 0;
const canGzip = () => typeof CompressionStream === "function";
/**
* Compresses `data` with the browser's gzip `CompressionStream`, or returns it unchanged where the
* browser has none.
*
* @remarks
* Reads the output with a reader loop. In Chromium, `new Response(stream).arrayBuffer()` does not
* finish while the page is being hidden, which is exactly when the final batch is sent.
*
* @param data - The bytes to compress.
* @returns The gzip bytes, or `data` itself.
* @internal
*/
async function compress(data) {
	if (!canGzip()) return data;
	const stream = new CompressionStream("gzip");
	const writer = stream.writable.getWriter();
	const written = writer.write(data).then(() => writer.close());
	const reader = stream.readable.getReader();
	const parts = [];
	let size = 0;
	for (let read = await reader.read(); !read.done; read = await reader.read()) {
		parts.push(read.value);
		size += read.value.byteLength;
	}
	await written;
	const result = new Uint8Array(size);
	let offset = 0;
	for (const part of parts) {
		result.set(part, offset);
		offset += part.byteLength;
	}
	return result;
}
/**
* Posts an OTLP request body outside any trace and reads the response.
*
* @remarks
* Keepalive is used when asked for and the limits shared by all exporters allow. A keepalive
* request the browser rejects anyway is sent once more without it; it still arrives unless the
* page is unloading. Chromium counts a keepalive request against the page's budget until its
* response body is read, so the limits are released only then; cancelling the body instead would
* show every export as failed in DevTools. The request and the read are aborted after 10 s.
*
* @param url - The absolute OTLP/HTTP URL.
* @param headers - The request headers, without `content-encoding`, which is added when the body
* is compressed.
* @param body - The request body.
* @param outlivePage - Whether the request should use keepalive, because the page is hidden.
* @returns The response, with its body read.
* @internal
*/
async function post(url, headers, body, outlivePage) {
	const keepalive = outlivePage && keepaliveBytes + body.byteLength <= KEEPALIVE_MAX_BYTES && keepaliveRequests < KEEPALIVE_MAX_REQUESTS;
	if (keepalive) {
		keepaliveBytes += body.byteLength;
		keepaliveRequests++;
	}
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, TIMEOUT_MS);
	const send = (withKeepalive) => context.with(suppressTracing(context.active()), () => fetch(url, {
		method: "POST",
		headers: canGzip() ? {
			...headers,
			"content-encoding": "gzip"
		} : headers,
		body,
		keepalive: withKeepalive,
		signal: controller.signal
	}));
	try {
		const response = await send(keepalive).catch((error) => {
			if (keepalive && error instanceof TypeError) return send(false);
			throw error;
		});
		await response.arrayBuffer();
		return response;
	} finally {
		clearTimeout(timer);
		if (keepalive) {
			keepaliveBytes -= body.byteLength;
			keepaliveRequests--;
		}
	}
}
// src/version.ts
/**
* The version of this package, reported as `telemetry.distro.version`.
*
* @internal
*/
const VERSION = "1.2.1";
// src/rum/sanitize-url.ts
const EVENTS_WITHOUT_HOOK = /* @__PURE__ */ new Set(["browser.navigation_timing", "browser.resource_timing"]);
/**
* Wraps a user `sanitizeUrl` so that it never throws.
*
* @remarks
* Upstream navigation calls the hook without a guard, so a throw would escape `history.pushState`
* into the app. A failed or non-string result becomes `''`, so a broken hook records no URL rather
* than the raw one. The first failure is reported through `diag.warn`.
*
* @param sanitizeUrl - The user's hook.
* @returns The guarded hook.
* @internal
*/
function guardSanitizeUrl(sanitizeUrl) {
	let warned = false;
	return (url) => {
		try {
			const sanitized = sanitizeUrl(url);
			if (typeof sanitized === "string") return sanitized;
		} catch (error) {
			if (!warned) {
				warned = true;
				diag.warn("@clickhouse/clickstack-browser: sanitizeUrl failed; the URL is left out", error);
			}
		}
		return "";
	};
}
/**
* Rewrites `url.full` on the navigation timing and resource timing events, which have no upstream
* hook.
*
* @param sanitizeUrl - The guarded hook.
* @returns A log record processor to run before the export.
* @internal
*/
function createUrlSanitizerLogRecordProcessor(sanitizeUrl) {
	return {
		onEmit: (logRecord) => {
			const url = logRecord.attributes[ATTR_URL_FULL];
			if (logRecord.eventName !== void 0 && EVENTS_WITHOUT_HOOK.has(logRecord.eventName) && typeof url === "string") logRecord.setAttribute(ATTR_URL_FULL, sanitizeUrl(url));
		},
		forceFlush: () => Promise.resolve(),
		shutdown: () => Promise.resolve()
	};
}
// src/semconv.ts
/** The session id on every replay record. @internal */
const ATTR_SESSION_ID = "session.id";
/** @internal */
const ATTR_USER_ID = "user.id";
/** @internal */
const ATTR_USER_EMAIL = "user.email";
/** @internal */
const ATTR_USER_NAME = "user.name";
/** @internal */
const ATTR_USER_FULL_NAME = "user.full_name";
/** @internal */
const ATTR_USER_ROLES = "user.roles";
export { ATTR_USER_NAME as a, guardSanitizeUrl as c, post as d, pageState as f, signalUrl as h, ATTR_USER_ID as i, VERSION as l, resolveUrl as m, ATTR_USER_EMAIL as n, ATTR_USER_ROLES as o, hasSignalPath as p, ATTR_USER_FULL_NAME as r, createUrlSanitizerLogRecordProcessor as s, ATTR_SESSION_ID as t, compress as u };

//# sourceMappingURL=semconv.js.map