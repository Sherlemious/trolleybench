import { describe, expect, it } from "vitest";
import { InvalidDatabaseUrl, MissingDatabaseUrl, connect } from "../src/client.js";

/**
 * These are about what happens to the *credential* on the failure paths, not about
 * connecting. postgres.js does not dial the server until the first query, so
 * constructing a client here touches no network.
 *
 * The bug being pinned: `DATABASE_URL` was set on the deployment with its surrounding
 * quotes still attached, copied out of a `.env` file. postgres.js rejected it with
 * `ERR_INVALID_URL` and carried the offending string on `error.input`; nothing caught
 * it, so the platform's log handler wrote the whole connection string - password
 * included - into the runtime logs. The route returned a bare 500 and said nothing.
 */
const REAL_SHAPE = "postgresql://user:hunter2@db.example.neon.tech/neondb?sslmode=require";

describe("connection string handling", () => {
  it("accepts a value that still has its quotes from a .env file", () => {
    const connection = connect({ url: `"${REAL_SHAPE}"` });
    expect(connection.db).toBeDefined();
    return connection.close();
  });

  it("accepts single quotes too", () => {
    const connection = connect({ url: `'${REAL_SHAPE}'` });
    expect(connection.db).toBeDefined();
    return connection.close();
  });

  it("rejects a malformed url without repeating it", () => {
    let thrown: unknown;
    try {
      connect({ url: "not-a-url://@@@" });
    } catch (cause) {
      thrown = cause;
    }

    expect(thrown).toBeInstanceOf(InvalidDatabaseUrl);
    const message = (thrown as Error).message;
    expect(message).not.toContain("not-a-url");
    expect(message).toContain("DATABASE_URL");
  });

  it("never names the password, whatever the failure", () => {
    let thrown: unknown;
    try {
      connect({ url: `"postgresql://user:hunter2@@@@:::/bad"` });
    } catch (cause) {
      thrown = cause;
    }
    if (thrown) expect(JSON.stringify(thrown)).not.toContain("hunter2");
  });

  it("distinguishes absent from malformed", () => {
    expect(() => connect({ url: "" })).toThrow(MissingDatabaseUrl);
  });
});
