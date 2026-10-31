import { describe, expect, it } from "vitest";
import { checkPassword, hashPassword } from "./password";

describe("password hash verification", () => {
  it("accepts the matching password and rejects a different password", () => {
    const hash = hashPassword("correct horse battery staple");
    expect(checkPassword("correct horse battery staple", hash)).toBe(true);
    expect(checkPassword("incorrect", hash)).toBe(false);
  });

  it("rejects malformed or missing Firestore hashes without throwing", () => {
    expect(checkPassword("anything", "")).toBe(false);
    expect(checkPassword("anything", "salt:hash")).toBe(false);
    expect(checkPassword("anything", "undefined:undefined")).toBe(false);
  });
});
