import { describe, expect, it } from "vitest";
import { assertDisposableDatabase, disposableDatabaseProblem } from "../help-screenshots/guard";

const local = { HELP_SCREENS_SEED: "1", NODE_ENV: "test", DATABASE_URL: "postgresql://demo@localhost:5432/yuyu_help_screens" };

describe("guide screenshot seed guard", () => {
  it("allows an opted-in local database", () => {
    expect(disposableDatabaseProblem(local)).toBeNull();
    expect(disposableDatabaseProblem({ ...local, DATABASE_URL: "postgres://demo@127.0.0.1/db" })).toBeNull();
    expect(disposableDatabaseProblem({ ...local, DATABASE_URL: "postgresql://demo@[::1]:5432/db" })).toBeNull();
  });

  it.each([
    [{ ...local, HELP_SCREENS_SEED: undefined }, "HELP_SCREENS_SEED"],
    [{ ...local, NODE_ENV: "production" }, "production"],
    [{ ...local, DATABASE_URL: undefined }, "not set"],
    [{ ...local, DATABASE_URL: "postgresql://demo@db.example.org:5432/yuyu" }, "localhost"],
    [{ ...local, DATABASE_URL: "postgresql://demo@localhost.example.org/yuyu" }, "localhost"],
    [{ ...local, DATABASE_URL: "postgresql://demo@localhost/yuyu?host=/var/run/remote" }, "host parameter"],
    [{ ...local, DATABASE_URL: "mysql://demo@localhost/yuyu" }, "PostgreSQL"],
    [{ ...local, DATABASE_URL: "not a url" }, "valid URL"],
  ])("refuses %#", (env, reason) => {
    expect(disposableDatabaseProblem(env)).toContain(reason);
    expect(() => assertDisposableDatabase(env)).toThrow(/Refusing to seed guide screenshots/);
  });
});
