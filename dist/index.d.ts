import { n as ReplayRecording, t as RecordFunction } from "./recorder.js";
import { Attributes } from "@opentelemetry/api";
import { SessionIdGenerator, SessionStore } from "@opentelemetry/browser-sdk/session";
import "@opentelemetry/sdk-logs";
import { SpanProcessor } from "@opentelemetry/sdk-trace";
/**
 * How much of the console is captured as `browser.console` log events. Each level includes the
 * more severe ones (`'info'` also captures `console.log`).
 *
 * @public
 */
type ConsoleLevel = "error" | "warn" | "info" | "debug";
/**
 * Options of {@link init}.
 *
 * @public
 */
type ClickStackBrowserOptions = ClickStackBrowserCommonOptions & ReplayRecording<RecordFunction | Promise<RecordFunction>>;
/**
 * Options of {@link init} other than {@link ReplayRecording}.
 *
 * @public
 */
interface ClickStackBrowserCommonOptions {
  /**
   * OTLP/HTTP base URL of the collector, for example `https://example-collector.clickhouse.com:4318`,
   * or a same-origin proxy path such as `/otel`. `/v1/traces` and `/v1/logs` are appended to its
   * path, and a relative value resolves against the page URL. Required unless both
   * `tracesEndpoint` and `logsEndpoint` are set.
   */
  endpoint?: string | undefined;
  /**
   * Full URL for traces, used as is, like `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`. Replaces the traces
   * URL built from `endpoint`. Default: none.
   */
  tracesEndpoint?: string | undefined;
  /**
   * Full URL for logs and replay, used as is, like `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`. Replaces the
   * logs URL built from `endpoint`. Default: none.
   */
  logsEndpoint?: string | undefined;
  /**
   * Ingestion API key, sent as the `authorization` header. Default: none.
   */
  apiKey?: string | undefined;
  /** `service.name` of every span, log record and replay record. */
  serviceName: string;
  /**
   * Version of the app, such as `2.0.0` or a commit SHA, recorded as the resource attribute
   * `service.version`. Default: none.
   */
  serviceVersion?: string | undefined;
  /**
   * Deployment environment, such as `production` or `staging`, recorded as the resource attribute
   * `deployment.environment.name`. Default: none.
   */
  environment?: string | undefined;
  /**
   * Further resource attributes of all telemetry, replay records included, such as
   * `service.namespace`. `serviceName`, `serviceVersion` and `environment` win over the same keys
   * here. Default: none.
   */
  resourceAttributes?: Attributes | undefined;
  /**
   * Backend origins, such as `https://example-api.clickhouse.com`, whose fetch and XHR requests carry W3C
   * trace context headers so backend traces join the browser's. Same-origin requests always
   * carry them. A regular expression is matched against the full request URL. Each backend must
   * allow the `traceparent`, `tracestate` and `baggage` request headers in CORS. Default: none.
   */
  traceOrigins?: (string | RegExp)[] | undefined;
  /** Records a session replay. Default: `true`. */
  replay?: boolean | undefined;
  /** Console level captured as log events, or `false` for none. Default: `'error'`. */
  console?: ConsoleLevel | false | undefined;
  /**
   * Rewrites every URL before it is recorded, for example to remove tokens from query strings. It
   * applies to the page URL on spans and logs, fetch and XHR spans, navigation events, navigation
   * and resource timing events, and the page URL in the replay. A hook that throws or returns a
   * non-string records an empty URL. Default: none, URLs are recorded as they are.
   */
  sanitizeUrl?: ((url: string) => string) | undefined;
  /**
   * Requests that fetch, XHR and resource timing do not record, such as long-polling requests. A
   * string must equal the full request URL, and a regular expression is matched against it. The
   * collector's own URLs are always ignored. Default: none.
   */
  ignoreUrls?: (string | RegExp)[] | undefined;
  /**
   * Further span processors, such as one that copies ended spans to another tool. They run after
   * the session, document, user and attribute processors, so they see every attribute this package
   * adds, and before the exporter. Default: none.
   */
  spanProcessors?: SpanProcessor[] | undefined;
  /**
   * Makes each new `session.id`, for example to use the app's own session id. Default: a random
   * id.
   */
  sessionIdGenerator?: SessionIdGenerator | undefined;
  /**
   * Keeps the session across page loads. Default: `localStorage`, so tabs of the same origin
   * share one session.
   */
  sessionStore?: SessionStore | undefined;
}
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
export declare function init(options: ClickStackBrowserOptions): void;
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
export declare function getSessionId(): string | null;
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
export declare function startNewSession(): void;
/**
 * Stops sending replay events until {@link resumeReplay}, for example while the user withholds
 * consent. RUM continues. Works before `init`
 *
 * @public
 */
export declare function pauseReplay(): void;
/**
 * Sends replay events again after {@link pauseReplay}, starting with a full snapshot.
 *
 * @public
 */
export declare function resumeReplay(): void;
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
export declare function shutdown(): Promise<void>;
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
export declare function setAttributes(attributes: Attributes | null): void;
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
export declare function recordException(error: unknown, attributes?: Attributes): void;
/**
 * The signed-in user, recorded with the standard `user.*` attributes.
 *
 * @public
 */
interface User {
  /** Stable identifier, recorded as `user.id`. */
  id?: string | undefined;
  /** Email address, recorded as `user.email`. */
  email?: string | undefined;
  /** Short name or login, recorded as `user.name`. */
  name?: string | undefined;
  /** Full name, recorded as `user.full_name`. */
  fullName?: string | undefined;
  /** Roles, recorded as `user.roles`. */
  roles?: string[] | undefined;
}
/**
 * Sets the user recorded on every span and log record emitted from now on, replacing the previous
 * user. Works before `init`. Replay records carry no user attributes.
 *
 * @param user - The user, or `null` to stop recording user attributes. Empty fields are left out.
 * @public
 */
export declare function setUser(user: User | null): void;
export type { ClickStackBrowserCommonOptions, ClickStackBrowserOptions, ConsoleLevel, RecordFunction, ReplayRecording, User };
