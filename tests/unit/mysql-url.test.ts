import { describe, expect, it } from "vitest";
import { mysqlAuthOptions } from "@/lib/mysql-url";

describe("mysqlAuthOptions", () => {
  it("allows RSA public-key retrieval on loopback hosts only", () => {
    expect(mysqlAuthOptions(new URL("mysql://u:p@127.0.0.1:3307/db"))).toEqual({ allowPublicKeyRetrieval: true });
    expect(mysqlAuthOptions(new URL("mysql://u:p@localhost/db"))).toEqual({ allowPublicKeyRetrieval: true });
    expect(mysqlAuthOptions(new URL("mysql://u:p@db.example.com/db"))).toEqual({ allowPublicKeyRetrieval: false });
  });
  it("honours an explicit URL parameter", () => {
    expect(mysqlAuthOptions(new URL("mysql://u:p@db.example.com/db?allowPublicKeyRetrieval=true"))).toEqual({ allowPublicKeyRetrieval: true });
    expect(mysqlAuthOptions(new URL("mysql://u:p@127.0.0.1/db?allowPublicKeyRetrieval=false"))).toEqual({ allowPublicKeyRetrieval: false });
  });
});
