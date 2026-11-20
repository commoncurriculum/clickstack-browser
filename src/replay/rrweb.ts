import { record } from "@rrweb/record";
import type { RecordFunction } from "./recorder.ts";

// rrweb's own maskAllInputs leaves <input type="hidden"> values.
// Masking by tag name covers every input type.
const MASK_ALL_INPUTS = { input: true, textarea: true, select: true };

/**
 * The masking choices of the rrweb this package runs when the app passes no `record`.
 *
 * @internal
 */
export interface Masking {
  maskAllText: boolean;
  maskAllInputs: boolean;
}

/**
 * `record` from `@rrweb/record`, masking as chosen.
 *
 * @internal
 */
export function maskedRecord(masking: Masking): RecordFunction {
  function masked(options: Parameters<RecordFunction>[0]) {
    return record({
      ...options,
      ...(masking.maskAllText ? { maskTextSelector: "*" } : {}),
      maskInputOptions: masking.maskAllInputs
        ? MASK_ALL_INPUTS
        : { password: true },
      userTriggeredOnInput: true,
    });
  }
  masked.takeFullSnapshot = record.takeFullSnapshot;
  masked.mirror = record.mirror;

  return masked;
}
