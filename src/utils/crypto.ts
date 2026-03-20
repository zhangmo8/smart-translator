const encoder = new TextEncoder();

const MD5_SHIFT_AMOUNTS = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
  20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6,
  10, 15, 21,
];

const MD5_TABLE = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000) >>> 0);

function sum32(...values: number[]): number {
  let result = 0;
  values.forEach((value) => {
    result = (result + (value >>> 0)) >>> 0;
  });
  return result;
}

function rotateLeft(value: number, shift: number): number {
  return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function toBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? encoder.encode(value) : value;
}

function md5Bytes(input: string): Uint8Array {
  const source = encoder.encode(input);
  const bitLength = source.length * 8;
  const paddingLength = (56 - ((source.length + 1) % 64) + 64) % 64;
  const buffer = new Uint8Array(source.length + 1 + paddingLength + 8);
  buffer.set(source);
  buffer[source.length] = 0x80;

  const view = new DataView(buffer.buffer);
  view.setUint32(buffer.length - 8, bitLength >>> 0, true);
  view.setUint32(buffer.length - 4, Math.floor(bitLength / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let offset = 0; offset < buffer.length; offset += 64) {
    const chunk = new Uint32Array(16);
    for (let index = 0; index < 16; index += 1) {
      chunk[index] = view.getUint32(offset + index * 4, true);
    }

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let index = 0; index < 64; index += 1) {
      let f = 0;
      let g = 0;

      if (index < 16) {
        f = (b & c) | (~b & d);
        g = index;
      } else if (index < 32) {
        f = (d & b) | (~d & c);
        g = (5 * index + 1) % 16;
      } else if (index < 48) {
        f = b ^ c ^ d;
        g = (3 * index + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * index) % 16;
      }

      const next = d;
      d = c;
      c = b;
      b = sum32(b, rotateLeft(sum32(a, f, MD5_TABLE[index], chunk[g]), MD5_SHIFT_AMOUNTS[index]));
      a = next;
    }

    a0 = sum32(a0, a);
    b0 = sum32(b0, b);
    c0 = sum32(c0, c);
    d0 = sum32(d0, d);
  }

  const digest = new Uint8Array(16);
  const digestView = new DataView(digest.buffer);
  digestView.setUint32(0, a0, true);
  digestView.setUint32(4, b0, true);
  digestView.setUint32(8, c0, true);
  digestView.setUint32(12, d0, true);
  return digest;
}

async function hmacBytes(algorithm: 'SHA-1' | 'SHA-256', key: string | Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey('raw', toBytes(key), { name: 'HMAC', hash: algorithm }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
  return new Uint8Array(signature);
}

export function md5Hex(input: string): string {
  return bytesToHex(md5Bytes(input));
}

export function md5Base64(input: string): string {
  return bytesToBase64(md5Bytes(input));
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return bytesToHex(new Uint8Array(digest));
}

export async function hmacSha1Base64(key: string | Uint8Array, data: string): Promise<string> {
  return bytesToBase64(await hmacBytes('SHA-1', key, data));
}

export async function hmacSha256Bytes(key: string | Uint8Array, data: string): Promise<Uint8Array> {
  return hmacBytes('SHA-256', key, data);
}

export async function hmacSha256Hex(key: string | Uint8Array, data: string): Promise<string> {
  return bytesToHex(await hmacBytes('SHA-256', key, data));
}
