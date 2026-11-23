import { context, ROOT_CONTEXT, trace } from "@opentelemetry/api";
import type { ReadableSpan } from "@opentelemetry/sdk-trace";
import { expect, test, vi } from "vitest";
import {
  load,
  logRecords,
  resetAroundEachTest,
  rumBodies,
  started,
  type InitModule,
} from "../init/test-harness.ts";
import { recordException } from "./exceptions.ts";
import { startInteraction } from "./interactions.ts";

resetAroundEachTest();

async function initWithInteractions(
  interactions: boolean,
): Promise<{ module: InitModule; ended: ReadableSpan[] }> {
  const ended: ReadableSpan[] = [];
  const module = await load();
  module.init({
    endpoint: "/otel",
    serviceName: "web-app",
    replay: false,
    interactions,
    spanProcessors: [
      {
        onStart: () => undefined,
        onEnd: (span) => ended.push(span),
        forceFlush: () => Promise.resolve(),
        shutdown: () => Promise.resolve(),
      },
    ],
  });
  await started(module);
  return { module, ended };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("puts spans started after an await on the click's trace, and ends the click once idle", async () => {
  const { ended } = await initWithInteractions(true);
  const tracer = trace.getTracer("test");

  document.body.click();
  await sleep(10);
  const action = tracer.startSpan("action example");
  await sleep(1100);
  expect(ended.map((span) => span.name)).not.toContain("click");
  action.end();
  await vi.waitFor(
    () => {
      expect(ended.map((span) => span.name)).toContain("click");
    },
    { timeout: 2000 },
  );

  const click = ended.find((span) => span.name === "click");
  expect(click?.instrumentationScope.name).toBe("custom-action");
  expect(click?.parentSpanContext).toBeUndefined();
  expect(action.spanContext().traceId).toBe(click?.spanContext().traceId);
  expect(
    ended.find((span) => span.name === "action example")?.parentSpanContext
      ?.spanId,
  ).toBe(click?.spanContext().spanId);
});

test("replaces the open interaction on a submit, and keeps it for startInteraction without replace", async () => {
  const { ended } = await initWithInteractions(true);
  const tracer = trace.getTracer("test");

  document.body.click();
  const message = startInteraction("receive room:*", { replace: false });
  const inClick = tracer.startSpan("in the click");
  inClick.end();
  document.body.dispatchEvent(new Event("submit"));
  const inSubmit = tracer.startSpan("in the submit");
  inSubmit.end();

  expect(trace.getSpan(message)?.spanContext().traceId).toBe(
    inClick.spanContext().traceId,
  );
  expect(ended.map((span) => span.name)).toContain("click");
  expect(ended.map((span) => span.name)).not.toContain("receive room:*");
  expect(inSubmit.spanContext().traceId).not.toBe(
    inClick.spanContext().traceId,
  );
  expect(
    context.with(trace.setSpan(ROOT_CONTEXT, inClick), () =>
      trace.getActiveSpan(),
    ),
  ).toBe(inClick);
  const bound = context.bind(trace.setSpan(ROOT_CONTEXT, inClick), () =>
    trace.getActiveSpan(),
  );
  expect(bound()).toBe(inClick);
  expect(context.bind(ROOT_CONTEXT, "not a function")).toBe("not a function");
});

test("ends the open interaction on shutdown and starts none after it", async () => {
  const { module, ended } = await initWithInteractions(true);

  document.body.click();
  await module.shutdown();
  document.body.click();

  expect(ended.filter((span) => span.name === "click")).toHaveLength(1);
});

test("starts a pageload interaction, which spans and errors with no active span join until a click", async () => {
  const { module, ended } = await initWithInteractions(true);
  const tracer = trace.getTracer("test");

  const action = tracer.startSpan("action example");
  action.end();
  recordException(new Error("load-time error"));
  document.body.click();
  const inClick = tracer.startSpan("in the click");
  inClick.end();
  await module.shutdown();

  const pageload = ended.find((span) => span.name === "pageload");
  const click = ended.find((span) => span.name === "click");
  expect(pageload?.instrumentationScope.name).toBe("custom-action");
  expect(pageload?.parentSpanContext).toBeUndefined();
  expect(action.spanContext().traceId).toBe(pageload?.spanContext().traceId);
  expect(inClick.spanContext().traceId).toBe(click?.spanContext().traceId);
  expect(click?.spanContext().traceId).not.toBe(
    pageload?.spanContext().traceId,
  );
  const error = logRecords(await rumBodies("/otel/v1/logs")).find((record) =>
    JSON.stringify(record).includes("load-time error"),
  );
  expect(error?.traceId).toBe(pageload?.spanContext().traceId);
});

test("starts no interaction without the interactions option", async () => {
  const { ended } = await initWithInteractions(false);
  const tracer = trace.getTracer("test");

  document.body.click();
  expect(startInteraction("navigate lessons", { replace: true })).toBe(
    context.active(),
  );
  await sleep(10);
  const action = tracer.startSpan("action example");
  action.end();
  await sleep(1100);

  expect(ended.map((span) => span.name)).not.toContain("click");
  expect(ended.map((span) => span.name)).not.toContain("navigate lessons");
  expect(
    ended.find((span) => span.name === "action example")?.parentSpanContext,
  ).toBeUndefined();
});
