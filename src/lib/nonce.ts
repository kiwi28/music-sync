import "server-only";

/**
 * CSP-compliant nonce generator.
 * Uses the Web Crypto API — works in both Node.js and Edge runtimes.
 * Does NOT use Node.js Buffer (unlike the old implementation in utils.ts).
 */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  // btoa + String.fromCharCode replaces the Node-only Buffer.toString("base64")
  return btoa(String.fromCharCode(...array));
}
