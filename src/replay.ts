/**
 * Session replay for apps that set up the upstream OpenTelemetry browser SDK themselves.
 *
 * @packageDocumentation
 */

export { startReplay } from "./replay/start.ts";
export type {
  ReplayController,
  ReplayStartCommonOptions,
  ReplayStartOptions,
} from "./replay/start.ts";
export type { RecordFunction, ReplayRecording } from "./replay/recorder.ts";
