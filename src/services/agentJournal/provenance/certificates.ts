/**
 * View certificates — what an editor view presents to its tab's provenance
 * session to attach without breaking the window: proof that the session
 * already saw everything the view displayed.
 *
 * Key decisions:
 *   - Only the session issues and redeems them, through the authority it
 *     holds privately (`certificateAuthority`); a module-private token
 *     guards the constructor. A certificate is opaque: its owner,
 *     generation and spent state live in the authority, so a copied,
 *     deserialized, hand-made or tampered object redeems nothing, and
 *     another session's authority does not know it.
 *   - Each is bound to one owner (the view, or the collector's key for a
 *     view not yet built) and to the session's generation when it was
 *     issued: `openView` issues one for a fresh view, a collector's detach
 *     one for the same view across a hide/show. Any change of the text, or
 *     any break, since then makes it stale; another owner cannot redeem it.
 *     Each is presented once.
 *
 * @coordinates-with services/agentJournal/provenance/session.ts — the issuer and the only checker
 * @module services/agentJournal/provenance/certificates
 */

const ISSUE = Symbol("provenanceSession.issue");

/** Opaque: what it certifies is held by the authority that issued it, never by the object. */
export class ViewCertificate {
  constructor(token: symbol) {
    if (token !== ISSUE) throw new TypeError("a view certificate is issued only by its session");
  }
}

/** A session's private issuer and checker. */
export interface CertificateAuthority {
  /** A certificate for `owner` at `generation`. */
  issue(owner: object, generation: number): ViewCertificate;
  /** `cert` was issued here for `owner` at `generation` and not presented before; spends it. */
  redeem(cert: ViewCertificate | null, owner: object, generation: number): boolean;
}

/** A fresh authority; the session keeps it in a private field, so no one else can issue or redeem for it. */
export function certificateAuthority(): CertificateAuthority {
  const outstanding = new WeakMap<ViewCertificate, { owner: object; generation: number }>();
  return {
    issue(owner, generation) {
      const cert = new ViewCertificate(ISSUE);
      outstanding.set(cert, { owner, generation });
      return cert;
    },
    redeem(cert, owner, generation) {
      const terms = cert === null ? undefined : outstanding.get(cert);
      if (terms === undefined || cert === null) return false;
      outstanding.delete(cert);
      return terms.owner === owner && terms.generation === generation;
    },
  };
}
