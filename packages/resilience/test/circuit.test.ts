import { describe, expect, it } from "vitest";

import { CircuitOpenError, createCircuit } from "../src";

const clockAt = (start: number) => {
  let t = start;
  return { now: () => new Date(t), advance: (seconds: number) => (t += seconds * 1000) };
};
const OPTIONS = { failureThreshold: 3, openSeconds: 30 };

describe("createCircuit", () => {
  it("opens after N failures in a row, refuses at once, probes once and closes on success", () => {
    const clock = clockAt(0);
    const circuit = createCircuit(OPTIONS, clock);
    for (let i = 0; i < 3; i++) {
      circuit.check();
      circuit.failure();
    }
    expect(circuit.isOpen).toBe(true);
    expect(() => circuit.check()).toThrow(CircuitOpenError);
    clock.advance(10);
    expect(() => circuit.check()).toThrowError(expect.objectContaining({ retryAfterSeconds: 20 }));
    clock.advance(20);
    circuit.check(); // the probe
    expect(() => circuit.check()).toThrow(CircuitOpenError); // second caller waits while it is in flight
    circuit.success();
    expect(circuit.isOpen).toBe(false);
    circuit.check();
  });

  it("a failed probe opens it again", () => {
    const clock = clockAt(0);
    const circuit = createCircuit({ failureThreshold: 1, openSeconds: 5 }, clock);
    circuit.failure();
    clock.advance(5);
    circuit.check();
    circuit.failure();
    expect(() => circuit.check()).toThrow(CircuitOpenError);
  });

  it("a success resets the count: failures must be in a row", () => {
    const circuit = createCircuit(OPTIONS, clockAt(0));
    circuit.failure();
    circuit.failure();
    circuit.success();
    circuit.failure();
    expect(circuit.isOpen).toBe(false);
  });

  it("throws the client's own error when given one", () => {
    const circuit = createCircuit({ failureThreshold: 1, openSeconds: 5 }, clockAt(0), {
      refuse: (seconds) => new RangeError(`wait ${seconds}`),
    });
    circuit.failure();
    expect(() => circuit.check()).toThrow(new RangeError("wait 5"));
  });
});
