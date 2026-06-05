import { afterEach, describe, expect, test } from "bun:test";
import { handleHttpFetch } from "./http-fetch";

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
  server?.stop(true);
  server = null;
});

describe("handleHttpFetch", () => {
  test("preserves manual redirects and Set-Cookie headers", async () => {
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/login") {
          return new Response(null, {
            status: 302,
            headers: {
              location: "/reader",
              "set-cookie": "substack.sid=sid123; Path=/; HttpOnly",
            },
          });
        }
        if (url.pathname === "/reader") {
          return new Response("reader");
        }
        return new Response("not found", { status: 404 });
      },
    });

    const response = await handleHttpFetch({
      url: new URL("/login", server.url).toString(),
      init: { redirect: "manual" },
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe("/reader");
    expect(response.setCookie).toEqual(["substack.sid=sid123; Path=/; HttpOnly"]);
  });
});
