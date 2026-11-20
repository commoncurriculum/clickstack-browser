import { n as ReplayRecording, t as RecordFunction } from "./recorder.js";
import { Attributes } from "@opentelemetry/api";
import { SessionProvider, SessionPublisher } from "@opentelemetry/browser-sdk/session";
/**
 * Options of {@link startReplay}.
 *
 * @public
 */
type ReplayStartOptions = ReplayStartCommonOptions & ReplayRecording;
/**
 * Options of {@link startReplay} other than {@link ReplayRecording}.
 *
 * @public
 */
interface ReplayStartCommonOptions {
  /**
   * The upstream `SessionManager` that the SDK's session processors use, usable after
   * `await sessionManager.start()`. Replay records carry its session id.
   */
  sessionManager: SessionProvider & SessionPublisher;
  /**
   * OTLP/HTTP base URL of the collector. `/v1/logs` is appended to its path. A relative value, such
   * as a same-origin proxy path, resolves against the page URL.
   */
  endpoint: string;
  /** Ingestion API key. Sent as the `authorization` header. Default: none. */
  apiKey?: string | undefined;
  /**
   * `service.name` of the replay records. It must equal the SDK's since ClickStack finds a
   * session's replay with it.
   */
  serviceName: string;
  /** Further resource attributes, same as the SDK's. Default: none. */
  resourceAttributes?: Attributes | undefined;
  /**
   * Rewrites the page URL recorded in replay meta events, for example to drop tokens from the
   * query string. Pass the same function as to the instrumentations' `sanitizeUrl`. A throw or a
   * non-string result records an empty URL. Default: none.
   */
  sanitizeUrl?: ((url: string) => string) | undefined;
}
/**
 * Controls a recording started by {@link startReplay}.
 *
 * @public
 */
interface ReplayController {
  /** Stops sending replay events until {@link ReplayController.resume} */
  pause(): void;
  /** Sends replay events again, starting with a full snapshot */
  resume(): void;
  /**
   * Stops recording and sends the buffered records
   *
   * @returns A promise that resolves once the records are sent
   */
  shutdown(): Promise<void>;
}
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
export declare function startReplay(options: ReplayStartOptions): ReplayController;
export type { RecordFunction, ReplayController, ReplayRecording, ReplayStartCommonOptions, ReplayStartOptions };
