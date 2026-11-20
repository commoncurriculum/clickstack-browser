import { a as ATTR_USER_NAME, c as guardSanitizeUrl, d as post, f as pageState, h as signalUrl, i as ATTR_USER_ID, l as VERSION, m as resolveUrl, n as ATTR_USER_EMAIL, o as ATTR_USER_ROLES, p as hasSignalPath, r as ATTR_USER_FULL_NAME, s as createUrlSanitizerLogRecordProcessor, u as compress } from "./semconv.js";
import { DiagConsoleLogger, DiagLogLevel, diag } from "@opentelemetry/api";
import { ConsoleInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/console";
import { ErrorsInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/errors";
import { FetchInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/fetch";
import { NavigationInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation";
import { NavigationTimingInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation-timing";
import { UserActionInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/user-action";
import { WebVitalsInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/web-vitals";
import { XhrInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/xhr";
import { startBrowserSdk } from "@opentelemetry/browser-sdk";
import { browserDetector } from "@opentelemetry/browser-sdk/browser-detector";
import { createDocumentLogRecordProcessor, createDocumentSpanProcessor, createLocationDocumentProvider } from "@opentelemetry/browser-sdk/document";
import { createDefaultSessionIdGenerator, createLocalStorageSessionStore, createSessionLogRecordProcessor, createSessionManager, createSessionSpanProcessor } from "@opentelemetry/browser-sdk/session";
import { LongTaskInstrumentation } from "@opentelemetry/instrumentation-long-task";
import { JsonLogsSerializer, JsonTraceSerializer } from "@opentelemetry/otlp-transformer";
import { detectResources } from "@opentelemetry/resources";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace";
import { ATTR_DEPLOYMENT_ENVIRONMENT_NAME, ATTR_EXCEPTION_MESSAGE, ATTR_EXCEPTION_STACKTRACE, ATTR_EXCEPTION_TYPE, ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION, ATTR_TELEMETRY_DISTRO_NAME, ATTR_TELEMETRY_DISTRO_VERSION, ATTR_URL_FULL } from "@opentelemetry/semantic-conventions";
import { ExportResultCode } from "@opentelemetry/core";
import { SeverityNumber, logs } from "@opentelemetry/api-logs";
// src/internal/otlp-exporter.ts
const KEEPALIVE_PART_BYTES = 16384;
/**
* Sends gzip-compressed OTLP/JSON request bodies built by an upstream serializer, such as
* `JsonTraceSerializer`, with `fetch`.
*
* @remarks
* Upstream's browser transport sets `keepalive` on every request that fits its limits and never
* reads the response, which Chromium counts against the page's 64 KiB budget until then. With small
* batches, exports during a burst use up the budget and the final flush when the user leaves finds
* no room. This exporter asks for `keepalive` only while the page is hidden, the one time a request
* has to outlive the page, and then splits a batch over 16 KiB compressed, so the parts that fit
* the budget arrive even when the whole would not. Failed exports are not retried.
*
* @internal
*/
var OtlpJsonExporter = class {
	#url;
	#headers;
	#serializer;
	#pending = /* @__PURE__ */ new Set();
	#warned = false;
	/**
	* Creates an exporter for one OTLP/HTTP signal URL.
	*
	* @param url - The absolute OTLP/HTTP URL, such as the traces URL.
	* @param apiKey - The ingestion key for the `authorization` header, if any.
	* @param serializer - The upstream OTLP/JSON serializer for the signal.
	*/
	constructor(url, apiKey, serializer) {
		this.#url = url;
		this.#headers = {
			...apiKey ? { authorization: apiKey } : {},
			"content-type": "application/json"
		};
		this.#serializer = serializer;
	}
	/**
	* Sends the items in one request, or in parts while the page is hidden.
	*
	* @param items - The batch from the batch processor.
	* @param resultCallback - Called with success once every request finished. Failures are logged
	* here once.
	*/
	export(items, resultCallback) {
		const sending = this.#send(items).catch((error) => {
			this.#warn(error);
		}).then(() => {
			this.#pending.delete(sending);
			resultCallback({ code: ExportResultCode.SUCCESS });
		});
		this.#pending.add(sending);
	}
	/** Resolves when every started request has finished */
	async forceFlush() {
		await Promise.all(this.#pending);
	}
	/** Resolves when every started request has finished */
	shutdown() {
		return this.forceFlush();
	}
	async #send(items) {
		const body = await this.#compress(items);
		if (body === void 0) return;
		const hidden = document.visibilityState === "hidden";
		const bodies = hidden ? await this.#split(items, body) : [body];
		await Promise.all(bodies.map((part) => this.#post(part, hidden)));
	}
	async #compress(items) {
		const json = this.#serializer.serializeRequest(items);
		return json === void 0 ? void 0 : compress(json);
	}
	async #split(items, body) {
		if (body.byteLength <= KEEPALIVE_PART_BYTES || items.length < 2) return [body];
		const half = Math.ceil(items.length / 2);
		const bodies = [];
		for (const part of [items.slice(0, half), items.slice(half)]) {
			const partBody = await this.#compress(part);
			if (partBody !== void 0) bodies.push(...await this.#split(part, partBody));
		}
		return bodies;
	}
	async #post(body, hidden) {
		try {
			const response = await post(this.#url, this.#headers, body, hidden);
			if (!response.ok) this.#warn(`HTTP ${String(response.status)}`);
		} catch (error) {
			this.#warn(error);
		}
	}
	#warn(reason) {
		if (!this.#warned) {
			this.#warned = true;
			diag.warn(`@clickhouse/clickstack-browser: export to ${new URL(this.#url).host} failed; later failures are not logged`, reason);
		}
	}
};
// src/rum/exceptions.ts
const SCOPE = "@clickhouse/clickstack-browser";
const MAX_CAUSES = 5;
/**
* Describes a thrown value as `exception.*` attributes. Errors, and objects shaped like them (such
* as errors from another frame), give their name, message and stack; other values are recorded as
* JSON text, because upstream records them with no message at all.
*
* @remarks
* An error's `cause` chain, up to five deep, is appended to the stack as `Caused by:` sections, the
* layout of Java's `printStackTrace`.
*
* @param value - The thrown value or rejection reason.
* @returns The attributes.
* @internal
*/
function exceptionAttributes(value) {
	if (typeof value === "string") return { [ATTR_EXCEPTION_MESSAGE]: value };
	if (isErrorLike(value)) {
		const { name, message } = value;
		const stacktrace = stackWithCauses(value);
		return {
			...typeof name === "string" ? { [ATTR_EXCEPTION_TYPE]: name } : {},
			...typeof message === "string" ? { [ATTR_EXCEPTION_MESSAGE]: message } : {},
			...stacktrace === void 0 ? {} : { [ATTR_EXCEPTION_STACKTRACE]: stacktrace }
		};
	}
	return { [ATTR_EXCEPTION_MESSAGE]: toText(value) };
}
function isErrorLike(value) {
	return typeof value === "object" && value !== null && ("message" in value || "stack" in value);
}
function stackWithCauses(error) {
	const { stack } = error;
	let text = typeof stack === "string" ? stack : void 0;
	const seen = /* @__PURE__ */ new Set([error]);
	let { cause } = error;
	for (let depth = 0; depth < MAX_CAUSES && cause !== void 0 && !seen.has(cause); depth++) {
		seen.add(cause);
		const causeText = isErrorLike(cause) ? errorText(cause) : toText(cause);
		text = `${text ?? Error.prototype.toString.call(error)}\nCaused by: ${causeText}`;
		cause = isErrorLike(cause) ? cause.cause : void 0;
	}
	return text;
}
function errorText(error) {
	const header = Error.prototype.toString.call(error);
	const { stack } = error;
	if (typeof stack !== "string") return header;
	return stack.startsWith(header) ? stack : `${header}\n${stack}`;
}
function toText(value) {
	try {
		const json = JSON.stringify(value);
		if (json !== void 0) return json;
	} catch {}
	return String(value);
}
let consoleError;
/**
* Serializes console arguments into the log body as the browser console shows them. Format codes
* in a leading string take the arguments that follow (the Console Standard's Formatter, as in
* Node's `util.format`), errors appear as their message and stack (upstream's default JSON-encodes
* them, which gives `{}`), and other values as upstream writes them. Remembers the first error for
* {@link consoleExceptionProcessor}.
*
* @param args - The console call's arguments.
* @returns The log body.
* @internal
*/
function serializeConsoleArgs(args) {
	consoleError = args.find((arg) => arg instanceof Error);
	const [first, ...rest] = args;
	if (typeof first !== "string" || rest.length === 0) return args.map(consoleText).join(" ");
	let used = 0;
	return [first.replace(/%(.)/g, (code, specifier) => {
		if (specifier === "%") return "%";
		if (used >= rest.length) return code;
		switch (specifier) {
			case "s":
			case "o":
			case "O": return consoleText(rest[used++]);
			case "d":
			case "i": return numberText(rest[used++], (text) => Number.parseInt(text, 10));
			case "f": return numberText(rest[used++], Number.parseFloat);
			case "c":
				used++;
				return "";
			default: return code;
		}
	}), ...rest.slice(used).map(consoleText)].join(" ");
}
function numberText(arg, parse) {
	return typeof arg === "symbol" ? "NaN" : String(parse(String(arg)));
}
function consoleText(arg) {
	if (arg instanceof Error) return errorText(arg);
	if (typeof arg === "object" && arg !== null) try {
		return JSON.stringify(arg);
	} catch {
		return Object.prototype.toString.call(arg);
	}
	return String(arg);
}
/**
* Adds `exception.*` attributes to a console log record whose arguments included an error, as the
* logging bridges of other languages do for a logged exception.
*
* @remarks
* Upstream's console instrumentation calls the serializer and then emits the record in the same
* call, so the remembered error belongs to the next record.
*
* @internal
*/
const consoleExceptionProcessor = {
	onEmit: (logRecord) => {
		const error = consoleError;
		consoleError = void 0;
		if (error !== void 0 && logRecord.eventName === "browser.console") logRecord.setAttributes(exceptionAttributes(error));
	},
	forceFlush: () => Promise.resolve(),
	shutdown: () => Promise.resolve()
};
/**
* Records an error your code caught, such as in a `try`/`catch`, as an `exception` log event: the
* same event that uncaught errors produce.
*
* @remarks
* Errors passed to `console.error`, including React's reports of errors caught by error
* boundaries, are already recorded; calling this for them as well records them twice. Does nothing
* before `init` has started or after `shutdown`. Inside an active span, the event is
* linked to that span.
*
* @example
* ```ts
* try {
*   await checkout();
* } catch (error) {
*   recordException(error, { "app.operation": "checkout" });
* }
* ```
*
* @param error - The caught value. Values that are not errors are recorded as JSON text.
* @param attributes - Further attributes for the event. Default: none.
* @public
*/
function recordException(error, attributes) {
	logs.getLogger(SCOPE, VERSION).emit({
		eventName: "exception",
		severityNumber: SeverityNumber.ERROR,
		attributes: {
			...exceptionAttributes(error),
			...attributes
		}
	});
}
/**
* Records failed loads of images, scripts, stylesheets and media as `exception` log events with
* the type `ResourceLoadError`.
*
* @remarks
* These `error` events do not bubble, so upstream's errors instrumentation, which listens on
* `window` without capture, never sees them.
*
* @param sanitizeUrl - The guarded URL rewriter, if any.
* @returns A function that removes the listener.
* @internal
*/
function listenForResourceErrors(sanitizeUrl) {
	const onError = ({ target }) => {
		if (!(target instanceof Element)) return;
		const url = resourceUrl(target);
		if (!url) return;
		const recorded = sanitizeUrl ? sanitizeUrl(url) : url;
		const element = `<${target.tagName.toLowerCase()}>`;
		logs.getLogger(SCOPE, VERSION).emit({
			eventName: "exception",
			severityNumber: SeverityNumber.ERROR,
			attributes: {
				[ATTR_EXCEPTION_TYPE]: "ResourceLoadError",
				[ATTR_EXCEPTION_MESSAGE]: recorded ? `Failed to load ${element} ${recorded}` : `Failed to load ${element}`,
				...recorded ? { [ATTR_URL_FULL]: recorded } : {}
			}
		});
	};
	window.addEventListener("error", onError, true);
	return () => {
		window.removeEventListener("error", onError, true);
	};
}
function resourceUrl(element) {
	if (element instanceof HTMLImageElement || element instanceof HTMLMediaElement) return element.currentSrc || element.src;
	if (element instanceof HTMLScriptElement || element instanceof HTMLSourceElement || element instanceof HTMLTrackElement) return element.src;
	if (element instanceof HTMLLinkElement) return element.href;
	return "";
}
// src/rum/attributes.ts
let customAttributes = {};
/**
* Sets attributes recorded on every span and log record emitted from now on, such as a tenant, a
* plan or a feature flag, replacing the previous set. Works before `init`. Replay records carry
* none of them.
*
* @remarks
* Attributes that the SDK, an instrumentation or `setUser` sets, such as `session.id` or
* `user.id`, win over these. Prefer namespaced keys, such as `app.team.name`.
*
* @example
* ```ts
* setAttributes({ "app.team.name": team.name, "app.plan": team.plan });
* ```
*
* @param attributes - The attributes, or `null` to stop recording them.
* @public
*/
function setAttributes(attributes) {
	customAttributes = { ...attributes };
}
function missingFrom(current) {
	const missing = {};
	for (const [key, value] of Object.entries(customAttributes)) if (!(key in current)) missing[key] = value;
	return missing;
}
/**
* Adds the attributes from {@link setAttributes} to every span when it starts, without replacing
* any it already has. Runs after the other span processors.
*
* @internal
*/
const attributesSpanProcessor = {
	onStart: (span) => {
		span.setAttributes(missingFrom(span.attributes));
	},
	onEnd: () => void 0,
	forceFlush: () => Promise.resolve(),
	shutdown: () => Promise.resolve()
};
/**
* Adds the attributes from {@link setAttributes} to every log record when it is emitted, without
* replacing any it already has. Runs after the other log record processors.
*
* @internal
*/
const attributesLogRecordProcessor = {
	onEmit: (logRecord) => {
		logRecord.setAttributes(missingFrom(logRecord.attributes));
	},
	forceFlush: () => Promise.resolve(),
	shutdown: () => Promise.resolve()
};
// src/rum/user.ts
let userAttributes = {};
/**
* Sets the user recorded on every span and log record emitted from now on, replacing the previous
* user. Works before `init`. Replay records carry no user attributes.
*
* @param user - The user, or `null` to stop recording user attributes. Empty fields are left out.
* @public
*/
function setUser(user) {
	const next = {};
	if (user?.id) next[ATTR_USER_ID] = user.id;
	if (user?.email) next[ATTR_USER_EMAIL] = user.email;
	if (user?.name) next[ATTR_USER_NAME] = user.name;
	if (user?.fullName) next[ATTR_USER_FULL_NAME] = user.fullName;
	if (user?.roles?.length) next[ATTR_USER_ROLES] = [...user.roles];
	userAttributes = next;
}
/**
* Adds the current user attributes to every span when it starts.
*
* @internal
*/
const userSpanProcessor = {
	onStart: (span) => {
		span.setAttributes(userAttributes);
	},
	onEnd: () => void 0,
	forceFlush: () => Promise.resolve(),
	shutdown: () => Promise.resolve()
};
/**
* Adds the current user attributes to every log record when it is emitted.
*
* @internal
*/
const userLogRecordProcessor = {
	onEmit: (logRecord) => {
		logRecord.setAttributes(userAttributes);
	},
	forceFlush: () => Promise.resolve(),
	shutdown: () => Promise.resolve()
};
// src/init/init.ts
const CONSOLE_METHODS = {
	error: ["error"],
	warn: ["error", "warn"],
	info: [
		"error",
		"warn",
		"info",
		"log"
	],
	debug: [
		"error",
		"warn",
		"info",
		"log",
		"debug"
	]
};
const BATCH_CONFIG = {
	maxExportBatchSize: 64,
	scheduledDelayMillis: 5e3
};
const OPTION_NAMES = new Set(Object.keys({
	endpoint: true,
	tracesEndpoint: true,
	logsEndpoint: true,
	apiKey: true,
	serviceName: true,
	serviceVersion: true,
	environment: true,
	resourceAttributes: true,
	traceOrigins: true,
	replay: true,
	maskAllText: true,
	maskAllInputs: true,
	console: true,
	sanitizeUrl: true,
	ignoreUrls: true,
	spanProcessors: true
}));
const run = {
	sessionId: null,
	replayPaused: false
};
/**
* Starts browser RUM and session replay on the upstream OpenTelemetry browser SDK.
*
* @remarks
* Starts in the background. It restores or creates the session,
* starts the SDK with the session, document and user processors,
* enables the fetch, XHR, errors, navigation, user action, web vitals, navigation
* timing, resource timing, long task and console instrumentations, and records the replay.
* Telemetry from before the SDK has started is not captured. Without a document (such as for server-side
* rendering, workers) it does nothing. Only the first call on a page counts, subsequent calls log a
* warning.
*
* @example
* ```ts
* init({ endpoint: 'https://example-collector.clickhouse.com:4318', serviceName: 'example-app' });
* ```
*
* @param options - The endpoint, the service name, and the few choices this package offers.
* @public
*/
function init(options) {
	if (typeof document === "undefined") return;
	const page = pageState();
	if (page.initialized) {
		diag.warn("@clickhouse/clickstack-browser: init already ran on this page; this call is ignored");
		return;
	}
	const tracesUrl = options.tracesEndpoint ? resolveUrl(options.tracesEndpoint)?.href : signalUrl(options.endpoint, "traces");
	const logsUrl = options.logsEndpoint ? resolveUrl(options.logsEndpoint)?.href : signalUrl(options.endpoint, "logs");
	if (tracesUrl === void 0 || logsUrl === void 0 || !options.serviceName) {
		diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
		diag.error("@clickhouse/clickstack-browser: init needs a serviceName and an http(s) endpoint, or both tracesEndpoint and logsEndpoint");
		return;
	}
	page.initialized = true;
	run.started = start(options, tracesUrl, logsUrl, optionWarnings(options)).catch((error) => {
		diag.error("@clickhouse/clickstack-browser: init failed", error);
	});
}
function optionWarnings(options) {
	const warnings = [];
	const unknown = Object.keys(options).filter((name) => !OPTION_NAMES.has(name));
	if (unknown.length > 0) warnings.push(`unknown init options are ignored: ${unknown.join(", ")}`);
	if ((!options.tracesEndpoint || !options.logsEndpoint) && hasSignalPath(options.endpoint)) warnings.push("endpoint is the collector base URL; its trailing /v1/traces or /v1/logs is dropped");
	return warnings;
}
async function start(options, tracesUrl, logsUrl, warnings) {
	const sessionManager = createSessionManager({
		sessionIdGenerator: createDefaultSessionIdGenerator(),
		sessionStore: createLocalStorageSessionStore(),
		maxDuration: 14400,
		inactivityTimeout: 900
	});
	run.sessionManager = sessionManager;
	await sessionManager.start();
	const { ResourceTimingInstrumentation } = await import("@opentelemetry/browser-instrumentation/experimental/resource-timing");
	if (run.stopping !== void 0) return;
	run.sessionId = sessionManager.getSessionId();
	sessionManager.addObserver({
		onSessionStarted: (session) => {
			run.sessionId = session.id;
		},
		onSessionEnded: () => void 0
	});
	const resourceAttributes = {
		...detectResources({ detectors: [browserDetector] }).attributes,
		...options.resourceAttributes,
		[ATTR_TELEMETRY_DISTRO_NAME]: "clickstack-browser",
		[ATTR_TELEMETRY_DISTRO_VERSION]: VERSION,
		[ATTR_SERVICE_NAME]: options.serviceName,
		...options.serviceVersion ? { [ATTR_SERVICE_VERSION]: options.serviceVersion } : {},
		...options.environment ? { [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: options.environment } : {}
	};
	const sanitizeUrl = options.sanitizeUrl ? guardSanitizeUrl(options.sanitizeUrl) : void 0;
	const sanitize = sanitizeUrl ? { sanitizeUrl } : {};
	const ignoreUrls = [
		tracesUrl,
		logsUrl,
		...options.ignoreUrls ?? []
	];
	const propagateTraceHeaderCorsUrls = (options.traceOrigins ?? []).map(toUrlPattern);
	const consoleLevel = options.console ?? "error";
	const instrumentations = [
		new FetchInstrumentation({
			enabled: false,
			ignoreUrls,
			propagateTraceHeaderCorsUrls,
			...sanitize
		}),
		new XhrInstrumentation({
			enabled: false,
			ignoreUrls,
			propagateTraceHeaderCorsUrls,
			...sanitize
		}),
		new ResourceTimingInstrumentation({
			enabled: false,
			ignoreUrls
		}),
		new ErrorsInstrumentation({
			enabled: false,
			applyCustomAttributes: exceptionAttributes
		}),
		new NavigationInstrumentation({
			enabled: false,
			...sanitize
		}),
		new NavigationTimingInstrumentation({ enabled: false }),
		new UserActionInstrumentation({ enabled: false }),
		new WebVitalsInstrumentation({ enabled: false }),
		new LongTaskInstrumentation({ enabled: false }),
		...consoleLevel ? [new ConsoleInstrumentation({
			enabled: false,
			logMethods: CONSOLE_METHODS[consoleLevel],
			messageSerializer: serializeConsoleArgs
		})] : []
	];
	const documentProvider = createLocationDocumentProvider(sanitize);
	run.sdk = startBrowserSdk({
		logLevel: "WARN",
		resourceAttributes,
		logs: { processors: [
			createSessionLogRecordProcessor(sessionManager),
			createDocumentLogRecordProcessor(documentProvider),
			userLogRecordProcessor,
			consoleExceptionProcessor,
			...sanitizeUrl ? [createUrlSanitizerLogRecordProcessor(sanitizeUrl)] : [],
			attributesLogRecordProcessor,
			new BatchLogRecordProcessor({
				exporter: new OtlpJsonExporter(logsUrl, options.apiKey, JsonLogsSerializer),
				...BATCH_CONFIG
			})
		] },
		traces: { processors: [
			createSessionSpanProcessor(sessionManager),
			createDocumentSpanProcessor(documentProvider),
			userSpanProcessor,
			attributesSpanProcessor,
			...options.spanProcessors ?? [],
			new BatchSpanProcessor({
				exporter: new OtlpJsonExporter(tracesUrl, options.apiKey, JsonTraceSerializer),
				...BATCH_CONFIG
			})
		] },
		instrumentations
	});
	run.stopResourceErrors = listenForResourceErrors(sanitizeUrl);
	for (const warning of warnings) diag.warn(`@clickhouse/clickstack-browser: ${warning}`);
	if (options.replay !== false) await startRecorder(options, sessionManager, logsUrl, resourceAttributes, sanitizeUrl);
}
async function startRecorder(options, sessionManager, logsUrl, resourceAttributes, sanitizeUrl) {
	const [{ Recorder }, { createReplayProvider }] = await Promise.all([import("./recorder.js").then((n) => n.n), import("./exporter.js").then((n) => n.n)]);
	if (run.stopping !== void 0 || pageState().recording === true) return;
	run.recorder = new Recorder({
		sessionManager,
		provider: createReplayProvider(logsUrl, options.apiKey, resourceAttributes),
		maskAllText: options.maskAllText ?? true,
		maskAllInputs: options.maskAllInputs ?? true,
		sanitizeUrl
	});
	if (run.replayPaused) run.recorder.pause();
	run.recorder.start();
}
function toUrlPattern(origin) {
	if (origin instanceof RegExp) return origin;
	const escaped = origin.replace(/\/+$/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped}(?:[/?#]|$)`);
}
/**
* Returns the current session id, the same `session.id` that spans, log records and replay
* records carry (for example to link a support ticket or a backend trace to the session)
*
* @remarks
* Does not count as session activity.
*
* @returns The id, or `null` before `init` has started or after {@link shutdown}.
* @public
*/
function getSessionId() {
	return run.sessionId;
}
/**
* Ends the current session and starts one with a new `session.id`, for example when the user
* signs out. Replay continues in the new session from the next user input.
*
* @remarks
* Does nothing before `init` has started or after {@link shutdown}. It keeps the user set with
* `setUser`; call `setUser(null)` as well on sign-out.
*
* @public
*/
function startNewSession() {
	const sessionManager = run.sessionManager;
	if (sessionManager === void 0 || run.sessionId === null || run.stopping !== void 0) return;
	const { resetSession } = sessionManager;
	if (typeof resetSession === "function") {
		resetSession.call(sessionManager);
		return;
	}
	try {
		localStorage.removeItem("opentelemetry-session");
	} catch {}
	diag.warn("@clickhouse/clickstack-browser: startNewSession takes effect on the next page load");
}
/**
* Stops sending replay events until {@link resumeReplay}, for example while the user withholds
* consent. RUM continues. Works before `init`
*
* @public
*/
function pauseReplay() {
	run.replayPaused = true;
	run.recorder?.pause();
}
/**
* Sends replay events again after {@link pauseReplay}, starting with a full snapshot.
*
* @public
*/
function resumeReplay() {
	run.replayPaused = false;
	run.recorder?.resume();
}
/**
* Stops RUM and replay for the rest of the page. Sends what is buffered, stops recording, disables
* the instrumentations, and ends session tracking. A later `init` on this page is ignored. Upstream
* instrumentations leave their fetch, XHR, history, and console wrappers in place, passing calls
* through.
*
* @returns A promise that resolves once buffered telemetry is sent. It never rejects. Later calls
* return the same promise.
* @public
*/
function shutdown() {
	run.stopping ??= stop();
	return run.stopping;
}
async function stop() {
	pageState().initialized = true;
	try {
		await run.started;
		await run.recorder?.shutdown();
		run.stopResourceErrors?.();
		await run.sdk?.shutdown();
	} catch (error) {
		diag.warn("@clickhouse/clickstack-browser: shutdown failed", error);
	}
	run.sessionManager?.shutdown();
	run.sessionId = null;
}
export { getSessionId, init, pauseReplay, recordException, resumeReplay, setAttributes, setUser, shutdown, startNewSession };

//# sourceMappingURL=index.js.map