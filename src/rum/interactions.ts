import {
  context,
  ROOT_CONTEXT,
  trace,
  type Context,
  type ContextManager,
  type Span,
} from "@opentelemetry/api";
import type { SpanProcessor } from "@opentelemetry/sdk-trace";

// Sentry's idle span timeouts
const IDLE_MS = 1000;
const FINAL_MS = 30_000;

interface Interaction {
  span: Span;
  context: Context;
  pending: Set<string>;
  idle: ReturnType<typeof setTimeout>;
  final: ReturnType<typeof setTimeout>;
}

let enabled = false;
let open: Interaction | undefined;
let current: Context = ROOT_CONTEXT;

/**
 * Keeps the active context for synchronous code, like upstream's, and gives code with none, such
 * as code after an `await`, the open interaction's.
 *
 * @internal
 */
export const interactionContextManager: ContextManager = {
  active: () => (current === ROOT_CONTEXT && open ? open.context : current),
  with(ctx, fn, thisArg, ...args) {
    const previous = current;
    current = ctx;
    try {
      return fn.call(thisArg, ...args);
    } finally {
      current = previous;
    }
  },
  bind(ctx, target) {
    if (typeof target !== "function") {
      return target;
    }
    const fn = target as (...args: unknown[]) => unknown;
    return function (this: unknown, ...args: unknown[]): unknown {
      return interactionContextManager.with(ctx, () => fn.apply(this, args));
    } as typeof target;
  },
  enable() {
    enabled = true;
    return this;
  },
  disable() {
    enabled = false;
    end();
    current = ROOT_CONTEXT;
    return this;
  },
};

/**
 * Starts an interaction: a span that spans started with no active span join, until it has been
 * idle for 1 s after its last span ended, or for 30 s at most, like Sentry's idle spans. Clicks and
 * submits start one on their own.
 *
 * @example
 * ```ts
 * router.on('routeWillChange', (transition) => {
 *   startInteraction(`navigate ${transition.to.name}`, { replace: false });
 * });
 * ```
 *
 * @param name - The span's name.
 * @param options - `replace: false` keeps an open interaction instead of ending it, so a route
 * change or socket message doesn't cut short the click that caused it.
 * @returns The interaction's context, or the active context when `interactions` is off.
 * @public
 */
export function startInteraction(
  name: string,
  options: { replace: boolean },
): Context {
  if (!enabled) {
    return context.active();
  }
  if (open && !options.replace) {
    return open.context;
  }
  end();
  const span = trace
    .getTracer("custom-action")
    .startSpan(name, {}, ROOT_CONTEXT);
  open = {
    span,
    context: trace.setSpan(ROOT_CONTEXT, span),
    pending: new Set(),
    idle: setTimeout(end, IDLE_MS),
    final: setTimeout(end, FINAL_MS),
  };
  return open.context;
}

function end(): void {
  if (!open) {
    return;
  }
  clearTimeout(open.idle);
  clearTimeout(open.final);
  open.span.end();
  open = undefined;
}

/**
 * Keeps the open interaction going while spans of its trace are running.
 *
 * @internal
 */
export const interactionSpanProcessor: SpanProcessor = {
  onStart: (span) => {
    if (span.spanContext().traceId !== open?.span.spanContext().traceId) {
      return;
    }
    open.pending.add(span.spanContext().spanId);
    clearTimeout(open.idle);
  },
  onEnd: (span) => {
    if (!open?.pending.delete(span.spanContext().spanId)) {
      return;
    }
    if (open.pending.size === 0) {
      open.idle = setTimeout(end, IDLE_MS);
    }
  },
  forceFlush: () => Promise.resolve(),
  shutdown: () => {
    end();
    return Promise.resolve();
  },
};

/**
 * Starts an interaction on each click and submit.
 *
 * @returns A function that stops listening.
 * @internal
 */
export function listenForInteractions(): () => void {
  const listeners = (["click", "submit"] as const).map((type) => {
    const listener = () => startInteraction(type, { replace: true });
    document.addEventListener(type, listener, { capture: true });
    return () => {
      document.removeEventListener(type, listener, { capture: true });
    };
  });
  return () => {
    for (const stop of listeners) {
      stop();
    }
  };
}
