// Decifra um push "aes128gcm" (RFC 8291) como faria o navegador, para provar que o
// servidor cifrou certo para a inscrição e que o conteúdo chega íntegro.
import { createDecipheriv, createECDH, hkdfSync } from "node:crypto";

export interface TestSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  privateKey: Buffer;
}

const b64u = (b: Buffer) => b.toString("base64url");

export function makeSubscription(endpoint: string): TestSubscription {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint,
    keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(Buffer.from(Array.from({ length: 16 }, () => Math.floor(Math.random() * 256)))) },
    privateKey: ecdh.getPrivateKey(),
  };
}

export function decryptPush(sub: TestSubscription, body: Buffer): unknown {
  const salt = body.subarray(0, 16);
  const idLen = body[20];
  const asPublic = body.subarray(21, 21 + idLen);
  const cipher = body.subarray(21 + idLen);

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(sub.privateKey);
  const uaPublic = Buffer.from(sub.keys.p256dh, "base64url");
  const authSecret = Buffer.from(sub.keys.auth, "base64url");
  const shared = ecdh.computeSecret(asPublic);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));

  const d = createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  // remove o preenchimento: 0x02 (último registro) e zeros
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  if (plain[end - 1] !== 2 && plain[end - 1] !== 1) throw new Error("delimitador de preenchimento inválido");
  return JSON.parse(plain.subarray(0, end - 1).toString("utf8"));
}
