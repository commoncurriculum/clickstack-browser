import { c as guardSanitizeUrl, f as pageState, h as signalUrl } from "./semconv.js";
import { t as createReplayProvider } from "./exporter.js";
import { t as Recorder } from "./recorder.js";
import { diag } from "@opentelemetry/api";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { record } from "@rrweb/record";
// src/replay/start.ts
const NOT_RECORDING = {
	pause: () => void 0,
	resume: () => void 0,
	shutdown: () => Promise.resolve()
};
/**
* Records a session replay for an app that set up the upstream OpenTelemetry browser SDK itself.
*
* @remarks
* Should be called after `await sessionManager.start()`. Also add the replay logs URL (the endpoint plus
* `/v1/logs`) to the `ignoreUrls` of the fetch, XHR and resource timing instrumentations. Records
* nothing without a document (server-side rendering, workers), with an invalid endpoint, or while
* another recording runs on the page, because rrweb records one page at a time.
*
* @example
* ```ts
* const sessionManager = createSessionManager({
*   sessionIdGenerator: createDefaultSessionIdGenerator(),
*   sessionStore: createLocalStorageSessionStore(),
*   maxDuration: 4 * 60 * 60,
*   inactivityTimeout: 15 * 60,
* });
* await sessionManager.start();
* // Start the SDK with startBrowserSdk, giving its session processors `sessionManager`.
* const replay = startReplay({ sessionManager, endpoint: 'https://example-collector.clickhouse.com:4318', serviceName: 'example-app' });
* ```
*
* @param options - The session manager, the endpoint, the service name, the masking choices and the
* URL rewriter.
* @returns A controller, or a no-op one when nothing is recorded.
* @public
*/
function startReplay(options) {
	if (typeof document === "undefined") return NOT_RECORDING;
	const url = signalUrl(options.endpoint, "logs");
	if (url === void 0 || pageState().recording) {
		diag.warn("@clickhouse/clickstack-browser: replay not started: the endpoint is not an http(s) URL, or a recording already runs on this page");
		return NOT_RECORDING;
	}
	const recorder = new Recorder({
		sessionManager: options.sessionManager,
		record: options.record ?? record,
		provider: createReplayProvider(url, options.apiKey, {
			...options.resourceAttributes,
			[ATTR_SERVICE_NAME]: options.serviceName
		}),
		maskAllText: options.maskAllText ?? true,
		maskAllInputs: options.maskAllInputs ?? true,
		sanitizeUrl: options.sanitizeUrl ? guardSanitizeUrl(options.sanitizeUrl) : void 0
	});
	recorder.start();
	return {
		pause: () => {
			recorder.pause();
		},
		resume: () => {
			recorder.resume();
		},
		shutdown: () => recorder.shutdown()
	};
}
export { startReplay };

//# sourceMappingURL=replay.js.map