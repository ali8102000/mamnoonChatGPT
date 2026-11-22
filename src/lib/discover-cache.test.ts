import { describe, it, expect } from "vitest";
import { getOrLoadDiscoverData } from "./discover-cache";

describe("discovery data cache", () => {
  it("deduplicates simultaneous catalog loads and reuses the short-lived result", async () => {
    let calls = 0;
    const loader = async () => {
      calls += 1;
      await Promise.resolve();
      return [{ id: "public-catalog-item" }];
    };
    const [first, second] = await Promise.all([
      getOrLoadDiscoverData("test:discover:dedupe", loader),
      getOrLoadDiscoverData("test:discover:dedupe", loader),
    ]);
    const third = await getOrLoadDiscoverData("test:discover:dedupe", loader);
    expect(first).toEqual(second);
    expect(third).toEqual(first);
    expect(calls).toBe(1);
  });
});
