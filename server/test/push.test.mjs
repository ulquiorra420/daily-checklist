// Self-check: our push encryption must be readable by the reference RFC 8188/8291 implementation.
import assert from 'node:assert';
import crypto from 'node:crypto';
import ece from 'http_ece';
import { encryptPayload, vapidAuth } from '../push.js';

const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const auth = crypto.randomBytes(16);
const sub = { keys: { p256dh: ua.getPublicKey('base64url'), auth: auth.toString('base64url') } };
const msg = JSON.stringify({ title: 'Uống nước 💧', body: 'test' });
const body = Buffer.from(await encryptPayload(sub, msg));
const out = ece.decrypt(body, { version: 'aes128gcm', privateKey: ua, authSecret: auth.toString('base64url') });
assert.strictEqual(out.toString(), msg);
console.log('push encryption OK');

// VAPID header: a valid ES256 JWT for the push service, signed by our key, with the claims Apple requires.
const keys = await crypto.webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const env = { VAPID_SUBJECT: 'https://ulquiorra420.github.io',
  VAPID_PUBLIC: Buffer.from(await crypto.webcrypto.subtle.exportKey('raw', keys.publicKey)).toString('base64url'),
  VAPID_PRIVATE_JWK: JSON.stringify(await crypto.webcrypto.subtle.exportKey('jwk', keys.privateKey)) };
const header = await vapidAuth('https://web.push.apple.com/QGuQyavXutnMH...', env);
const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
assert.strictEqual(k, env.VAPID_PUBLIC);
const [h, c, sig] = jwt.split('.');
const claims = JSON.parse(Buffer.from(c, 'base64url'));
assert.strictEqual(claims.aud, 'https://web.push.apple.com');
assert.ok(claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 24 * 3600);
assert.ok(await crypto.webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.publicKey, Buffer.from(sig, 'base64url'), Buffer.from(h + '.' + c)));
console.log('VAPID signature OK');
