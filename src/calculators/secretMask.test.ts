import { describe, expect, it } from "vitest";
import { isEncryptedSecret, MASK_PREFIX, maskSecret } from "../background/secretStore";

describe("API key handling", () => {
  it("the side panel only gets a masked key", () => {
    expect(maskSecret("abcdef123456wxyz")).toBe(`${MASK_PREFIX}wxyz`);
    expect(maskSecret("")).toBe("");
  });

  it("recognizes the encrypted storage format and not plain text", () => {
    expect(isEncryptedSecret({ v: 1, iv: "AAAA", ct: "BBBB" })).toBe(true);
    expect(isEncryptedSecret("plain-key")).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
  });
});
