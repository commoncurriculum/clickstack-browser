import { t as __exportAll } from "./rolldown-runtime.js";
import { f as pageState, l as VERSION, t as ATTR_SESSION_ID } from "./semconv.js";
import { diag } from "@opentelemetry/api";
// src/replay/constants.ts
/** Instrumentation scope of replay log records. @internal */
const REPLAY_SCOPE_NAME = "rum.rr-web";
/** Event number in the session, shared by all chunks of one rrweb event. @internal */
const ATTR_RRWEB_EVENT = "rr-web.event";
/** 1-based chunk index within the event. @internal */
const ATTR_RRWEB_CHUNK = "rr-web.chunk";
/** Number of chunks of the event. @internal */
const ATTR_RRWEB_TOTAL_CHUNKS = "rr-web.total-chunks";
/** Record number in the session over every chunk; the player orders by it. @internal */
const ATTR_RRWEB_OFFSET = "rr-web.offset";
/** Largest chunk body in UTF-8 bytes. @internal */
const MAX_CHUNK_BYTES = 972800;
/** Replay recording stops for a session once it is this old. @internal */
const MAX_REPLAY_PER_SESSION_MS = 144e5;
// src/replay/chunker.ts
function codePointBytes(value, index) {
	const code = value.charCodeAt(index);
	if (code < 128) return 1;
	if (code < 2048) return 2;
	const next = value.charCodeAt(index + 1);
	return code >= 55296 && code <= 56319 && next >= 56320 && next <= 57343 ? 4 : 3;
}
/**
* Splits a serialized rrweb event into consecutive substrings of at most `maxBytes` UTF-8 bytes.
*
* @remarks
* Cuts fall only between code points. Each chunk is UTF-8 encoded on its own, and half of a
* surrogate pair would become U+FFFD. When joined in order the chunks give back `json` exactly.
*
* @param json - The serialized event.
* @param maxBytes - The largest chunk in UTF-8 bytes. Defaults to 950 KiB.
* @returns The chunks in order; `[json]` when it fits.
* @internal
*/
function splitIntoChunks(json, maxBytes = MAX_CHUNK_BYTES) {
	if (json.length * 3 <= maxBytes) return [json];
	const chunks = [];
	let start = 0;
	let bytes = 0;
	for (let i = 0; i < json.length;) {
		const size = codePointBytes(json, i);
		if (bytes + size > maxBytes && i > start) {
			chunks.push(json.slice(start, i));
			start = i;
			bytes = 0;
		}
		bytes += size;
		i += size === 4 ? 2 : 1;
	}
	chunks.push(json.slice(start));
	return chunks;
}
// src/replay/limiter.ts
const BUCKET_SIZE = 100;
const REFILL_PER_MS = 10 / 1e3;
/**
* Drops attribute mutations of nodes that change faster than 10 times a second after a burst of
* 100 so an element animated through its attributes cannot flood the replay. rrweb's `sampling`
* options throttle input, scroll, and mouse events, but have no equivalent for mutations.
*
* @remarks
* A node inside an SVG shares the bucket of its `svg` element since SVG animations
* change many child nodes at once. Text/add/remove mutations always pass. Buckets refill from
* the elapsed time when used, so the limiter needs no timer.
*
* @internal
*/
var MutationLimiter = class {
	#buckets = /* @__PURE__ */ new WeakMap();
	#onBlocked;
	/**
	* Creates a limiter with every bucket full.
	*
	* @param onBlocked - Called whenever a mutation is dropped, so the recorder can schedule a full
	* snapshot that repairs the dropped state.
	*/
	constructor(onBlocked) {
		this.#onBlocked = onBlocked;
	}
	/**
	* Applies the limit to one rrweb event without mutating it.
	*
	* @param event - The event rrweb emitted.
	* @param getNode - Looks up the live node of an rrweb mirror ID.
	* @param now - The current time in milliseconds.
	* @returns A copy of the event without the dropped attribute mutations, or `undefined` when nothing
	* is left of it.
	*/
	filter(event, getNode, now) {
		if (event.type !== 3 || event.data.source !== 0) return event;
		const { attributes, adds, removes, texts } = event.data;
		const kept = attributes.filter((mutation) => {
			const node = getNode(mutation.id);
			return node === null || this.#take(node.closest("svg") ?? node, now);
		});
		if (kept.length === attributes.length) return event;
		this.#onBlocked();
		if (kept.length + adds.length + removes.length + texts.length === 0) return;
		return {
			...event,
			data: {
				...event.data,
				attributes: kept
			}
		};
	}
	/** Refills every bucket */
	reset() {
		this.#buckets = /* @__PURE__ */ new WeakMap();
	}
	#take(key, now) {
		const bucket = this.#buckets.get(key) ?? {
			tokens: BUCKET_SIZE,
			at: now
		};
		bucket.tokens = Math.min(BUCKET_SIZE, bucket.tokens + (now - bucket.at) * REFILL_PER_MS);
		bucket.at = now;
		this.#buckets.set(key, bucket);
		if (bucket.tokens < 1) return false;
		bucket.tokens -= 1;
		return true;
	}
};
// src/replay/recorder.ts
var recorder_exports = /* @__PURE__ */ __exportAll({ Recorder: () => Recorder });
/**
* Records the page with rrweb and emits each event as `rr-web.*` log records of the current
* session.
*
* @remarks
* Each event becomes one or more chunks with a limited size. Per session, `rr-web.event` numbers the
* events and `rr-web.offset` numbers the records, both starting at 1, and the first
* event is a meta event followed by a full snapshot.
*
* After a session change, nothing is recorded until the tab is visible.
* For visible tabs, nothing is recorded until the first user input, then a full snapshot opens
* the new session. An idle open tab rotates its session every inactivity timeout, and a snapshot
* per rotation would store data nobody watches. Sessions will stop recording after the configured timeout.
*
* The session id is cached from the session manager's observer. `getSessionId()` is called again
* only for user input, because upstream counts every call as session activity, and DOM mutations
* alone must not keep a session alive.
*
* @internal
*/
var Recorder = class {
	#sessionManager;
	#record;
	#provider;
	#sanitizeUrl;
	#logger;
	#limiter = new MutationLimiter(() => {
		this.#onThrottled();
	});
	#sessionId = "";
	#sessionStart = 0;
	#events = 0;
	#offset = 0;
	#stopRrweb;
	#paused = false;
	#waitingForVisible = false;
	#waitingForInput = false;
	#needsSnapshot = false;
	#snapshotQueued = false;
	#capReached = false;
	#stopped = false;
	#warned = false;
	#snapshotTimer;
	#shutdown;
	/**
	* Creates a recorder. Nothing is recorded until {@link Recorder.start}.
	*
	* @param options - The session manager, the rrweb, the replay provider, and the URL rewriter.
	*/
	constructor(options) {
		this.#sessionManager = options.sessionManager;
		this.#record = options.record;
		this.#provider = options.provider;
		this.#sanitizeUrl = options.sanitizeUrl;
		this.#logger = options.provider.getLogger(REPLAY_SCOPE_NAME, VERSION);
	}
	/** Starts following the session and recording. */
	start() {
		pageState().recording = true;
		setTimeout(() => {
			this.#begin();
		}, 0);
	}
	/** Drops replay events until {@link Recorder.resume}. */
	pause() {
		this.#paused = true;
	}
	/** Sends replay events again, starting with a full snapshot. */
	resume() {
		this.#paused = false;
		this.#requestSnapshot();
	}
	/**
	* Stops rrweb and its listeners and sends the buffered records. Later calls return the same
	* promise.
	*
	* @returns A promise that resolves once the records are sent.
	*/
	shutdown() {
		this.#shutdown ??= this.#shutDown();
		return this.#shutdown;
	}
	async #shutDown() {
		this.#stopped = true;
		this.#reconcile();
		document.removeEventListener("visibilitychange", this);
		document.removeEventListener("DOMContentLoaded", this);
		pageState().recording = false;
		await this.#provider.shutdown();
	}
	#begin() {
		if (this.#stopped) return;
		const manager = this.#sessionManager;
		this.#enterSession(manager.getSessionId() ?? "", manager.getSession?.().startTimestamp);
		manager.addObserver({
			onSessionStarted: (session) => {
				this.#onSessionStarted(session);
			},
			onSessionEnded: () => void 0
		});
		document.addEventListener("visibilitychange", this);
		if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", this, { once: true });
		else this.#reconcile();
	}
	#enterSession(id, startTimestamp) {
		this.#sessionId = id;
		this.#sessionStart = startTimestamp ?? Date.now();
		this.#events = Math.floor(Math.random() * 2 ** 52);
		this.#offset = Date.now() * 1e3;
		this.#limiter.reset();
		this.#capReached = Date.now() - this.#sessionStart > MAX_REPLAY_PER_SESSION_MS;
	}
	#onSessionStarted(session) {
		if (this.#stopped) return;
		this.#enterSession(session.id, session.startTimestamp);
		this.#waitingForVisible = document.visibilityState !== "visible";
		this.#waitingForInput = !this.#waitingForVisible;
		this.#needsSnapshot = true;
		this.#reconcile();
	}
	#reconcile() {
		const shouldRun = !this.#stopped && !this.#capReached;
		if (shouldRun && this.#stopRrweb === void 0) {
			this.#needsSnapshot = true;
			this.#stopRrweb = () => void 0;
			this.#stopRrweb = this.#record({
				emit: (event) => {
					this.#emit(event);
				},
				errorHandler: (error) => this.#onRrwebError(error)
			});
		} else if (!shouldRun && this.#stopRrweb !== void 0) {
			const stop = this.#stopRrweb;
			this.#stopRrweb = void 0;
			clearTimeout(this.#snapshotTimer);
			stop();
		}
	}
	#isGated() {
		return this.#paused || this.#waitingForVisible || this.#waitingForInput;
	}
	#requestSnapshot() {
		this.#needsSnapshot = true;
		if (this.#snapshotQueued) return;
		this.#snapshotQueued = true;
		queueMicrotask(() => {
			this.#snapshotQueued = false;
			if (this.#stopRrweb !== void 0 && !this.#isGated()) this.#record.takeFullSnapshot(true);
		});
	}
	#emit(event) {
		if (this.#stopRrweb === void 0) return;
		if (isUserInput(event)) {
			this.#sessionManager.getSessionId();
			if (this.#waitingForInput) {
				this.#waitingForInput = false;
				this.#requestSnapshot();
				return;
			}
		}
		if (this.#isGated()) return;
		if (this.#needsSnapshot) {
			if (event.type === 2) this.#needsSnapshot = false;
			else if (event.type !== 4) return;
		}
		if (event.timestamp - this.#sessionStart > 144e5) {
			this.#capReached = true;
			queueMicrotask(() => {
				this.#reconcile();
			});
			return;
		}
		if (isFromBlockedFrame(event, this.#record.mirror)) return;
		const kept = this.#limiter.filter(event, (id) => this.#record.mirror.getNode(id), performance.now());
		if (kept !== void 0) this.#send(kept);
	}
	#send(event) {
		const sanitizeUrl = this.#sanitizeUrl;
		const recorded = event.type === 4 && sanitizeUrl !== void 0 ? {
			...event,
			data: {
				...event.data,
				href: sanitizeUrl(event.data.href)
			}
		} : event;
		const chunks = splitIntoChunks(JSON.stringify(recorded));
		const eventNumber = ++this.#events;
		chunks.forEach((body, index) => {
			this.#logger.emit({
				timestamp: event.timestamp,
				body,
				attributes: {
					[ATTR_SESSION_ID]: this.#sessionId,
					[ATTR_RRWEB_EVENT]: eventNumber,
					[ATTR_RRWEB_CHUNK]: index + 1,
					[ATTR_RRWEB_TOTAL_CHUNKS]: chunks.length,
					[ATTR_RRWEB_OFFSET]: ++this.#offset
				}
			});
		});
	}
	#onThrottled() {
		this.#warnOnce("replay drops attribute changes of nodes that change too often");
		clearTimeout(this.#snapshotTimer);
		this.#snapshotTimer = setTimeout(() => {
			this.#requestSnapshot();
		}, 1e3);
	}
	#onRrwebError(error) {
		this.#warnOnce("rrweb failed", error);
		return true;
	}
	#warnOnce(message, ...args) {
		if (!this.#warned) {
			this.#warned = true;
			diag.warn(`@clickhouse/clickstack-browser: ${message}`, ...args);
		}
	}
	/**
	* Handles `visibilitychange` and `DOMContentLoaded` on the document. The recorder is its own
	* listener object, so shutdown removes both by the same reference.
	*
	* @param event - The document event.
	*/
	handleEvent(event) {
		if (event.type === "DOMContentLoaded") this.#reconcile();
		else if (this.#waitingForVisible && document.visibilityState === "visible") {
			this.#waitingForVisible = false;
			this.#requestSnapshot();
		}
	}
};
function isFromBlockedFrame(event, mirror) {
	if (event.type !== 3) return false;
	const data = event.data;
	const id = data.id ?? data.positions?.[0]?.id ?? (data.adds?.[0] ?? data.removes?.[0])?.parentId ?? (data.texts?.[0] ?? data.attributes?.[0])?.id;
	for (let node = id === void 0 ? null : mirror.getNode(id); node; node = (node.ownerDocument ?? node).defaultView?.frameElement) if (mirror.getMeta(node)?.attributes?.rr_width !== void 0) return true;
	return false;
}
function isUserInput(event) {
	if (event.type !== 3) return false;
	const { data } = event;
	switch (data.source) {
		case 1:
		case 3:
		case 6:
		case 12: return true;
		case 2: return data.type !== 5 && data.type !== 6;
		case 5: return data.userTriggered === true;
		default: return false;
	}
}
export { recorder_exports as n, Recorder as t };

//# sourceMappingURL=recorder.js.map