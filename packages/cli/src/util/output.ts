import { consola } from "consola";

/**
 * Tiny output abstraction. In default mode we use consola's chatty UX;
 * in --json mode every command prints exactly one JSON object on stdout
 * and stays silent on stderr-only progress, so CI can pipe `loadam <cmd>
 * --json | jq`.
 */
export interface OutputSink {
  readonly json: boolean;
  start(msg: string): void;
  info(msg: string): void;
  success(msg: string): void;
  step(msg: string): void;
  /** Emit the final structured result. In text mode this is a no-op aside from a hint line. */
  result(payload: Record<string, unknown>): void;
}

export function makeOutput(jsonMode: boolean): OutputSink {
  if (jsonMode) {
    return {
      json: true,
      start: () => undefined,
      info: () => undefined,
      success: () => undefined,
      step: () => undefined,
      result(payload) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      },
    };
  }
  return {
    json: false,
    start: (m) => consola.start(m),
    info: (m) => consola.info(m),
    success: (m) => consola.success(m),
    step: (m) => consola.log(m),
    result: () => undefined,
  };
}
