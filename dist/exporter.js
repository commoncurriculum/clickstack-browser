import { t as __exportAll } from "./rolldown-runtime.js";
import { d as post, u as compress } from "./semconv.js";
import { diag } from "@opentelemetry/api";
import { defaultResource, resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";
import { ExportResultCode } from "@opentelemetry/core";
// src/replay/exporter.ts
var exporter_exports = /* @__PURE__ */ __exportAll({
	ReplayExporter: () => ReplayExporter,
	createReplayProvider: () => createReplayProvider,
	toOtlpJson: () => toOtlpJson
});
const MAX_REQUEST_CHARS = 4194304;
const KEEPALIVE_MAX_BYTES = 32768;
function toAnyValue(value) {
	if (typeof value === "number") return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };
	if (typeof value === "boolean") return { boolValue: value };
	if (Array.isArray(value)) return { arrayValue: { values: value.map(toAnyValue) } };
	return { stringValue: String(value) };
}
function toKeyValues(attributes) {
	return Object.entries(attributes).filter(([, value]) => value !== void 0).map(([key, value]) => ({
		key,
		value: toAnyValue(value)
	}));
}
function toNanoseconds([seconds, nanoseconds]) {
	return (BigInt(seconds) * 1000000000n + BigInt(nanoseconds)).toString();
}
/**
* Serializes replay records as an OTLP/JSON logs export request.
*
* @remarks
* All records share one resource and one scope since they come from one logger.
*
* @param records - The records to send, at least one.
* @returns The JSON text of the request.
* @internal
*/
function toOtlpJson(records) {
	const [{ resource, instrumentationScope }] = records;
	return JSON.stringify({ resourceLogs: [{
		resource: { attributes: toKeyValues(resource.attributes) },
		scopeLogs: [{
			scope: {
				name: instrumentationScope.name,
				version: instrumentationScope.version
			},
			logRecords: records.map((record) => ({
				timeUnixNano: toNanoseconds(record.hrTime),
				observedTimeUnixNano: toNanoseconds(record.hrTimeObserved),
				body: toAnyValue(record.body),
				attributes: toKeyValues(record.attributes)
			}))
		}]
	}] });
}
function* bySize(records) {
	let group;
	let chars = 0;
	for (const record of records) {
		const size = record.body.length;
		if (group !== void 0 && chars + size <= MAX_REQUEST_CHARS) {
			group.push(record);
			chars += size;
		} else {
			if (group !== void 0) yield group;
			group = [record];
			chars = size;
		}
	}
	if (group !== void 0) yield group;
}
function split(batch) {
	const [first, ...rest] = batch;
	const [second, ...tail] = rest.splice(Math.ceil(batch.length / 2) - 1);
	return second === void 0 ? void 0 : [[first, ...rest], [second, ...tail]];
}
async function encode(batch) {
	return compress(new TextEncoder().encode(toOtlpJson(batch)));
}
async function keepaliveBodies(batch) {
	const body = await encode(batch);
	const halves = body.byteLength > KEEPALIVE_MAX_BYTES ? split(batch) : void 0;
	if (halves === void 0) return [body];
	return [...await keepaliveBodies(halves[0]), ...await keepaliveBodies(halves[1])];
}
/**
* Sends replay records as gzip-compressed OTLP/JSON with `fetch`.
*
* @internal
*/
var ReplayExporter = class {
	#url;
	#headers;
	#pending = /* @__PURE__ */ new Set();
	#keepaliveBytes = 0;
	#warned = false;
	/**
	* Creates an exporter for one OTLP logs URL.
	*
	* @param url - The absolute OTLP/HTTP logs URL.
	* @param apiKey - The ingestion key for the `authorization` header, if any.
	*/
	constructor(url, apiKey) {
		this.#url = url;
		this.#headers = {
			...apiKey ? { authorization: apiKey } : {},
			"content-type": "application/json"
		};
	}
	/**
	* Sends the records in requests with limited body size.
	*
	* @param records - The batch from the batch processor.
	* @param resultCallback - Called with success once every request finished. Failures are logged
	* here once.
	*/
	export(records, resultCallback) {
		const sending = this.#send(records).catch((error) => {
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
	async #send(records) {
		for (const batch of bySize(records)) if (document.visibilityState === "hidden") {
			const bodies = await keepaliveBodies(batch);
			await Promise.all(bodies.map((body) => this.#post(body, true)));
		} else await this.#post(await encode(batch), false);
	}
	async #post(body, hidden) {
		const withinShare = hidden && this.#keepaliveBytes + body.byteLength <= KEEPALIVE_MAX_BYTES;
		if (withinShare) this.#keepaliveBytes += body.byteLength;
		try {
			const response = await post(this.#url, this.#headers, body, withinShare);
			if (!response.ok) this.#warn(`HTTP ${String(response.status)}`);
		} catch (error) {
			this.#warn(error);
		} finally {
			if (withinShare) this.#keepaliveBytes -= body.byteLength;
		}
	}
	#warn(reason) {
		if (!this.#warned) {
			this.#warned = true;
			diag.warn(`@clickhouse/clickstack-browser: replay export to ${new URL(this.#url).host} failed; later failures are not logged`, reason);
		}
	}
};
/**
* Creates the logger provider that batches replay records with the upstream browser batch
* processor which also flushes when the page is hidden
*
* @param url - The absolute OTLP/HTTP logs URL.
* @param apiKey - The ingestion key, if any.
* @param resourceAttributes - The RUM resource attributes, so replay records carry the same
* `service.name` (ClickStack finds a session's replay by it).
* @returns The provider. Its `shutdown()` sends what is buffered.
* @internal
*/
function createReplayProvider(url, apiKey, resourceAttributes) {
	return new LoggerProvider({
		resource: defaultResource().merge(resourceFromAttributes(resourceAttributes)),
		processors: [new BatchLogRecordProcessor({
			exporter: new ReplayExporter(url, apiKey),
			scheduledDelayMillis: 5e3
		})]
	});
}
export { exporter_exports as n, createReplayProvider as t };

//# sourceMappingURL=exporter.js.map