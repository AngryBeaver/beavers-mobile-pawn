import { describe, expect, it } from "vitest";
import { angleToTable, toTable } from "../src/core/seat";

const UP: [number, number] = [0, -1];
const RIGHT: [number, number] = [1, 0];

describe("toTable", () => {
  it("leaves the bottom seat alone", () => {
    expect(toTable(UP, "bottom")).toEqual(UP);
    expect(toTable(RIGHT, "bottom")).toEqual(RIGHT);
  });
  it("mirrors both axes for the top seat", () => {
    expect(toTable(UP, "top")).toEqual([0, 1]);
    expect(toTable(RIGHT, "top")).toEqual([-1, 0]);
  });
  it("turns the left seat: their up is the table's right, their right is the table's down", () => {
    expect(toTable(UP, "left")).toEqual([1, 0]);
    expect(toTable(RIGHT, "left")).toEqual([0, 1]);
  });
  it("turns the right seat: their up is the table's left, their right is the table's up", () => {
    expect(toTable(UP, "right")).toEqual([-1, 0]);
    expect(toTable(RIGHT, "right")).toEqual([0, -1]);
  });
  it("keeps diagonals diagonal and never produces -0", () => {
    expect(toTable([2, -3], "right")).toEqual([-3, -2]);
    expect(Object.is(toTable([0, 0], "top")[0], 0)).toBe(true);
  });
});

describe("angleToTable", () => {
  // + 0 turns a rounded -0 into 0, toEqual tells them apart
  const dir = (a: number) => [Math.round(Math.cos(a)) + 0, Math.round(Math.sin(a)) + 0];
  it("agrees with toTable for every seat", () => {
    for (const seat of ["bottom", "left", "top", "right"] as const) {
      expect(dir(angleToTable(-Math.PI / 2, seat))).toEqual(toTable(UP, seat).map((v) => v + 0));
      expect(dir(angleToTable(0, seat))).toEqual(toTable(RIGHT, seat).map((v) => v + 0));
    }
  });
});
