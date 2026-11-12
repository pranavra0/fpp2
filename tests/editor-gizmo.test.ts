import { expect, test } from "bun:test";
import { moveAxisHalfExtents, moveAxisLength } from "../src/game/editor";

test("move axis arrowheads extend beyond the default platform bounds", () => {
    const screenSize = 0.88;
    const [halfX, , halfZ] = moveAxisHalfExtents([3, 0.4, 3], [0, 0, 0, 1]);
    const lengthX = moveAxisLength(screenSize, halfX);
    const lengthZ = moveAxisLength(screenSize, halfZ);
    const headLength = screenSize * 0.28;
    const shaftLengthX = Math.max(screenSize * 0.72, lengthX - headLength * 0.65);
    const shaftLengthZ = Math.max(screenSize * 0.72, lengthZ - headLength * 0.65);

    expect(lengthX - headLength).toBeGreaterThan(halfX);
    expect(lengthZ - headLength).toBeGreaterThan(halfZ);
    expect(shaftLengthX).toBeGreaterThan(halfX);
    expect(shaftLengthZ).toBeGreaterThan(halfZ);
    expect(moveAxisLength(screenSize, 0.2)).toBe(screenSize);
});

test("move axis bounds account for Y-rotated platform extents", () => {
    const half = Math.SQRT1_2;
    const [halfX, , halfZ] = moveAxisHalfExtents([4, 0.4, 1], [0, half, 0, half]);

    expect(halfX).toBeCloseTo(0.5);
    expect(halfZ).toBeCloseTo(2);
    expect(moveAxisLength(0.88, halfZ)).toBeGreaterThan(halfZ);
});
