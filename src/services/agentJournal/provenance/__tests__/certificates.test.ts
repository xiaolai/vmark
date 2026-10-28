// @vitest-environment node
// WI-AL1.4 — view certificates are issued and redeemed only through the issuing session's private authority: one redemption, for the owner and generation they were issued at; no other authority, hand-made object or reset field redeems one
import { describe, it, expect } from "vitest";
import { certificateAuthority, ViewCertificate } from "../certificates";

const owner = {};

describe("certificateAuthority", () => {
  it("redeems a certificate once, for its owner at its generation", () => {
    const ca = certificateAuthority();
    const cert = ca.issue(owner, 3);
    expect(cert).toBeInstanceOf(ViewCertificate);
    expect(ca.redeem(cert, owner, 3)).toBe(true);
    expect(ca.redeem(cert, owner, 3)).toBe(false);
  });

  it.each([
    ["another owner", {}, 3],
    ["another generation", owner, 4],
  ] as const)("refuses %s and spends the certificate", (_label, who, generation) => {
    const ca = certificateAuthority();
    const cert = ca.issue(owner, 3);
    expect(ca.redeem(cert, who, generation)).toBe(false);
    expect(ca.redeem(cert, owner, 3)).toBe(false);
  });

  it("another authority cannot redeem it, and leaves it valid for its own", () => {
    const [mine, theirs] = [certificateAuthority(), certificateAuthority()];
    const cert = mine.issue(owner, 0);
    expect(theirs.redeem(cert, owner, 0)).toBe(false);
    expect(mine.redeem(cert, owner, 0)).toBe(true);
  });

  it("refuses null and hand-made objects", () => {
    const ca = certificateAuthority();
    expect(ca.redeem(null, owner, 0)).toBe(false);
    const forged = Object.create(ViewCertificate.prototype) as ViewCertificate;
    expect(ca.redeem(forged, owner, 0)).toBe(false);
    expect(() => Reflect.construct(ViewCertificate, [Symbol("guess")])).toThrow(TypeError);
  });

  it("carries no state a holder can reset", () => {
    const ca = certificateAuthority();
    const cert = ca.issue(owner, 0);
    expect(ca.redeem(cert, owner, 0)).toBe(true);
    Object.assign(cert, { used: false, owner, generation: 0 });
    expect(ca.redeem(cert, owner, 0)).toBe(false);
  });
});
