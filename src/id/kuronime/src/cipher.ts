import '@matane-anime/extension-sdk/globals';

// The player API answers with CryptoJS "AesJson" payloads: base64 of `{"ct":<base64>,"iv":<hex>,"s":<hex salt>}`,
// AES-256-CBC with a key derived from a passphrase and the salt the way OpenSSL's EVP_BytesToKey does (MD5, one
// round). The host's `crypto.md5` takes text, and a salt is binary, so MD5 is done here.

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** MD5 of bytes, as bytes. */
export function md5Bytes(input: Uint8Array): Uint8Array {
  const length = input.length;
  const padded = new Uint8Array(((length + 8) >> 6) * 64 + 64);
  padded.set(input);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, (length << 3) >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(length / 2 ** 29), true);
  let a0 = 0x67452301;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476;
  for (let offset = 0; offset < padded.length; offset += 64) {
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      f = (f + a + (K[i] as number) + view.getUint32(offset + g * 4, true)) | 0;
      a = d;
      d = c;
      c = b;
      const shift = (S[(i >> 4) * 4 + (i % 4)] as number) | 0;
      b = (b + ((f << shift) | (f >>> (32 - shift)))) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16);
  const outView = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, i) => outView.setUint32(i * 4, word >>> 0, true));
  return out;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** OpenSSL's EVP_BytesToKey with MD5: `bytes` bytes of key material from a passphrase and a salt. */
export function evpBytesToKey(passphrase: string, salt: Uint8Array, bytes: number): Uint8Array {
  const pass = Uint8Array.from(passphrase, (ch) => ch.charCodeAt(0) & 0xff); // the passphrase is ASCII
  const blocks: Uint8Array[] = [];
  let have = 0;
  let previous: Uint8Array = new Uint8Array(0);
  while (have < bytes) {
    previous = md5Bytes(concat(previous, pass, salt));
    blocks.push(previous);
    have += previous.length;
  }
  return Uint8Array.from(concat(...blocks).subarray(0, bytes));
}

/** Decrypts a CryptoJS AesJson payload (base64 of the JSON) with a passphrase; returns the plain text. */
export function decryptPayload(payload: string, passphrase: string): string {
  const parsed = JSON.parse(base64.decode(payload)) as { ct?: string; iv?: string; s?: string };
  if (!parsed.ct || !parsed.iv || !parsed.s) throw new Error('Not an AesJson payload');
  const key = evpBytesToKey(passphrase, fromHex(parsed.s), 32);
  const plain = crypto.aesDecrypt(base64.decodeBytes(parsed.ct), key, {
    mode: 'cbc',
    iv: fromHex(parsed.iv),
    padding: true,
  });
  return utf8.decode(plain);
}
