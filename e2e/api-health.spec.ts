import { test, expect } from "@playwright/test";

test.describe("PulsePairs API smoke", () => {
  test("GET /health returns JSON status", async ({ request }) => {
    const res = await request.get("/health");
    expect(res.ok(), `expected 200, got ${res.status()}`).toBeTruthy();
    const body = await res.json();
    expect(body).toMatchObject({ status: expect.any(String) });
  });

  test("GET /markets accepts pair filter", async ({ request }) => {
    const res = await request.get("/markets?pair=BTC-USD");
    expect(res.ok(), `expected 200, got ${res.status()}`).toBeTruthy();
    const body = await res.json();
    expect(Array.isArray(body)).toBeTruthy();
  });
});
