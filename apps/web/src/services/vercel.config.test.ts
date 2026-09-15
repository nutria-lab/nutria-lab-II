import { describe, expect, it } from "vitest";
import vercelConfig from "../../vercel.json";

type Rewrite = {
  source: string;
  destination: string;
};

describe("Vercel same-site API routing", () => {
  it("proxies API requests before the SPA fallback so the browser keeps the session cookie same-site", () => {
    const config = vercelConfig as { rewrites: Rewrite[] };

    expect(config.rewrites).toHaveLength(2);
    expect(config.rewrites[0]).toEqual(
      expect.objectContaining({
        source: "/api/:path*",
        destination: "https://nutria-lab-ii-api.vercel.app/:path*",
      }),
    );
    expect(config.rewrites[1]).toEqual(
      expect.objectContaining({
        source: "/(.*)",
        destination: "/index.html",
      }),
    );
  });
});
