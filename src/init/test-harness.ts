import { context, diag, propagation, trace } from "@opentelemetry/api";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { logs } from "../logs-api.ts";
import { setAttributes } from "../rum/attributes.ts";
import { setUser } from "../rum/user.ts";

export type InitModule = typeof import("./init.ts");

export interface Request {
  url: string;
  init: RequestInit | undefined;
}

export interface OtlpJson {
  resourceSpans?: { scopeSpans: { spans: unknown[] }[] }[];
  resourceLogs?: { scopeLogs: { logRecords: LogRecordJson[] }[] }[];
}

export interface LogRecordJson {
  eventName?: string;
  traceId?: string;
  spanId?: string;
}

let copy = 0;
let api: InitModule | undefined;

export const requests: Request[] = [];

/**
 * Stubs `fetch` and resets every global init touches around each test of the file that calls it.
 */
export function resetAroundEachTest(): void {
  beforeEach(() => {
    requests.length = 0;
    localStorage.clear();
    Reflect.deleteProperty(
      globalThis,
      Symbol.for("@clickhouse/clickstack-browser"),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        requests.push({
          url: input instanceof Request ? input.url : String(input),
          init,
        });
        return Promise.resolve(new Response("ok"));
      }),
    );
  });

  afterEach(async () => {
    await api?.shutdown();

    api = undefined;
    setUser(null);
    setAttributes(null);

    vi.unstubAllGlobals();
    vi.restoreAllMocks();

    trace.disable();
    context.disable();
    propagation.disable();
    logs.disable();
    diag.disable();
  });
}

// Each test gets its own copy of the module since init() runs once per module and page
export async function load(): Promise<InitModule> {
  copy += 1;

  const url = `./init.ts?copy=${String(copy)}`;
  api = (await import(/* @vite-ignore */ url)) as InitModule;

  return api;
}

export async function started(module: InitModule): Promise<string> {
  await vi.waitFor(() => {
    expect(module.getSessionId()).not.toBeNull();
  });

  return module.getSessionId() ?? "";
}

export function sentTo(path: string): Request[] {
  return requests.filter((r) => r.url.endsWith(path));
}

async function gunzip(body: unknown): Promise<string> {
  const stream = new Blob([body as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));

  return new Response(stream).text();
}

// Every exporter sends gzip-compressed OTLP/JSON
export function bodiesSentTo(path: string): Promise<string[]> {
  return Promise.all(sentTo(path).map((r) => gunzip(r.init?.body)));
}

export function isReplay(body: string): boolean {
  return body.includes('"name":"rum.rr-web"');
}

export async function rumBodies(path: string): Promise<string> {
  return (await bodiesSentTo(path)).filter((b) => !isReplay(b)).join("\n");
}

export function logRecords(bodies: string): LogRecordJson[] {
  return bodies
    .split("\n")
    .filter((body) => body !== "")
    .flatMap((body) =>
      ((JSON.parse(body) as OtlpJson).resourceLogs ?? []).flatMap((r) =>
        r.scopeLogs.flatMap((s) => s.logRecords),
      ),
    );
}
