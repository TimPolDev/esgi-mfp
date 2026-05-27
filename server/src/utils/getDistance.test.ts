import { getDistance } from "./getDistance";

describe("getDistance", () => {
  it("returns 0 for the same point", () => {
    const point = { lat: 48.8566, lng: 2.3522 };
    expect(getDistance(point, point)).toBe(0);
  });
});