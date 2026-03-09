import * as crypto from 'node:crypto';
import * as tls from 'node:tls';
import { CertificateCache, generateHostCertificate, createHostTlsContext } from '../tls';

// Generate a self-signed CA for testing
function generateTestCA(): { cert: string; key: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // Create a self-signed CA certificate using a simple approach
  const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

  // For testing, we generate a minimal self-signed cert
  // Use Node.js X509Certificate if available for verification
  const cert = generateSelfSignedCA(privateKey, publicKey);

  return {
    cert,
    key: keyPem,
  };
}

function generateSelfSignedCA(
  privateKey: crypto.KeyObject,
  publicKey: crypto.KeyObject,
): string {
  // Build a minimal self-signed CA certificate using ASN.1 DER
  const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const serialNumber = crypto.randomBytes(16).toString('hex');
  const now = new Date();
  const notAfter = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  // Minimal TBS certificate
  const tbs = buildMinimalTbs(serialNumber, 'AgenShield Test CA', now, notAfter, pubKeyDer);
  const sign = crypto.createSign('SHA256');
  sign.update(tbs);
  const signature = sign.sign(privateKey);

  const fullCert = buildMinimalFullCert(tbs, signature);
  const certBase64 = fullCert.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < certBase64.length; i += 64) {
    lines.push(certBase64.slice(i, i + 64));
  }
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

// Minimal ASN.1 helpers for test CA generation
function encLen(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) { bytes.unshift(temp & 0xff); temp >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function seq(...items: Buffer[]): Buffer {
  const c = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x30]), encLen(c.length), c]);
}

function set(...items: Buffer[]): Buffer {
  const c = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x31]), encLen(c.length), c]);
}

function oid(nums: number[]): Buffer {
  const bytes: number[] = [nums[0] * 40 + nums[1]];
  for (let i = 2; i < nums.length; i++) {
    let v = nums[i];
    if (v >= 0x80) {
      const e: number[] = [];
      e.unshift(v & 0x7f); v >>= 7;
      while (v > 0) { e.unshift(0x80 | (v & 0x7f)); v >>= 7; }
      bytes.push(...e);
    } else bytes.push(v);
  }
  const c = Buffer.from(bytes);
  return Buffer.concat([Buffer.from([0x06]), encLen(c.length), c]);
}

function utf8(str: string): Buffer {
  const c = Buffer.from(str, 'utf-8');
  return Buffer.concat([Buffer.from([0x0c]), encLen(c.length), c]);
}

function int(value: Buffer | number): Buffer {
  let buf: Buffer;
  if (typeof value === 'number') {
    if (value === 0) buf = Buffer.from([0]);
    else {
      const b: number[] = [];
      let t = value;
      while (t > 0) { b.unshift(t & 0xff); t >>= 8; }
      if (b[0] & 0x80) b.unshift(0);
      buf = Buffer.from(b);
    }
  } else {
    buf = value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
  }
  return Buffer.concat([Buffer.from([0x02]), encLen(buf.length), buf]);
}

function bitStr(content: Buffer): Buffer {
  const p = Buffer.concat([Buffer.from([0x00]), content]);
  return Buffer.concat([Buffer.from([0x03]), encLen(p.length), p]);
}

function ctxTag(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0xa0 | tag]), encLen(content.length), content]);
}

function genTime(date: Date): Buffer {
  const str = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  const c = Buffer.from(str, 'ascii');
  return Buffer.concat([Buffer.from([0x18]), encLen(c.length), c]);
}

function buildMinimalTbs(
  serialHex: string, cn: string, notBefore: Date, notAfter: Date, pubKeyDer: Buffer,
): Buffer {
  const version = ctxTag(0, int(2));
  const serial = int(Buffer.from(serialHex, 'hex'));
  const sigAlg = seq(oid([1, 2, 840, 113549, 1, 1, 11]), Buffer.from([0x05, 0x00]));
  const name = seq(set(seq(oid([2, 5, 4, 3]), utf8(cn))));
  const validity = seq(genTime(notBefore), genTime(notAfter));
  return seq(version, serial, sigAlg, name, validity, name, pubKeyDer);
}

function buildMinimalFullCert(tbs: Buffer, signature: Buffer): Buffer {
  const sigAlg = seq(oid([1, 2, 840, 113549, 1, 1, 11]), Buffer.from([0x05, 0x00]));
  return seq(tbs, sigAlg, bitStr(signature));
}

describe('CertificateCache', () => {
  it('stores and retrieves certificates', () => {
    const cache = new CertificateCache(10);
    const cert = { cert: 'test-cert', key: 'test-key' };

    cache.set('example.com', cert);
    expect(cache.get('example.com')).toEqual(cert);
    expect(cache.size).toBe(1);
  });

  it('returns undefined for missing entries', () => {
    const cache = new CertificateCache();
    expect(cache.get('missing.com')).toBeUndefined();
  });

  it('evicts least recently used when at capacity', () => {
    const cache = new CertificateCache(3);

    cache.set('a.com', { cert: 'a', key: 'a' });
    cache.set('b.com', { cert: 'b', key: 'b' });
    cache.set('c.com', { cert: 'c', key: 'c' });

    // Access a.com to make it recently used
    cache.get('a.com');

    // Add d.com — should evict b.com (LRU)
    cache.set('d.com', { cert: 'd', key: 'd' });

    expect(cache.size).toBe(3);
    expect(cache.get('b.com')).toBeUndefined();
    expect(cache.get('a.com')).toBeDefined();
    expect(cache.get('c.com')).toBeDefined();
    expect(cache.get('d.com')).toBeDefined();
  });

  it('updates existing entry position on set', () => {
    const cache = new CertificateCache(2);

    cache.set('a.com', { cert: 'a1', key: 'a1' });
    cache.set('b.com', { cert: 'b', key: 'b' });

    // Update a.com — moves it to most recent
    cache.set('a.com', { cert: 'a2', key: 'a2' });

    // Add c.com — should evict b.com (now LRU)
    cache.set('c.com', { cert: 'c', key: 'c' });

    expect(cache.get('a.com')).toEqual({ cert: 'a2', key: 'a2' });
    expect(cache.get('b.com')).toBeUndefined();
  });

  it('clears all entries', () => {
    const cache = new CertificateCache();
    cache.set('a.com', { cert: 'a', key: 'a' });
    cache.set('b.com', { cert: 'b', key: 'b' });

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a.com')).toBeUndefined();
  });
});

describe('generateHostCertificate', () => {
  let testCA: { cert: string; key: string };

  beforeAll(() => {
    testCA = generateTestCA();
  });

  it('generates a PEM certificate and key for a hostname', () => {
    const result = generateHostCertificate('test.example.com', testCA.cert, testCA.key);

    expect(result.cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(result.cert).toContain('-----END CERTIFICATE-----');
    expect(result.key).toContain('-----BEGIN PRIVATE KEY-----');
    expect(result.key).toContain('-----END PRIVATE KEY-----');
  });

  it('generates different certificates for different hostnames', () => {
    const cert1 = generateHostCertificate('host1.com', testCA.cert, testCA.key);
    const cert2 = generateHostCertificate('host2.com', testCA.cert, testCA.key);

    expect(cert1.cert).not.toBe(cert2.cert);
    expect(cert1.key).not.toBe(cert2.key);
  });

  it('generated certificate is parseable as X509', () => {
    const result = generateHostCertificate('parseable.test', testCA.cert, testCA.key);

    // Verify the cert can be parsed
    const x509 = new crypto.X509Certificate(result.cert);
    expect(x509.subject).toContain('parseable.test');
  });

  it('generated certificate includes hostname as SAN', () => {
    const result = generateHostCertificate('san-test.example.com', testCA.cert, testCA.key);
    const x509 = new crypto.X509Certificate(result.cert);

    // subjectAltName should contain the hostname
    const san = x509.subjectAltName;
    expect(san).toContain('san-test.example.com');
  });

  it('generated key can create signatures', () => {
    const result = generateHostCertificate('sign-test.com', testCA.cert, testCA.key);

    const key = crypto.createPrivateKey(result.key);
    const sign = crypto.createSign('SHA256');
    sign.update('test data');
    const signature = sign.sign(key);

    expect(signature.length).toBeGreaterThan(0);
  });
});

describe('createHostTlsContext', () => {
  let testCA: { cert: string; key: string };

  beforeAll(() => {
    testCA = generateTestCA();
  });

  it('returns a SecureContext object', () => {
    const hostCert = generateHostCertificate('ctx-test.com', testCA.cert, testCA.key);
    const ctx = createHostTlsContext(hostCert, testCA.cert);

    // tls.SecureContext is an opaque object — verify it exists and has the internal context
    expect(ctx).toBeDefined();
    expect(typeof ctx).toBe('object');
    // It should be usable with tls.TLSSocket (duck-type check)
    expect(ctx.context).toBeDefined();
  });
});

describe('extractSubjectFromPem fallback', () => {
  it('uses fallback issuer for invalid PEM input', () => {
    // Pass garbage PEM — exercises the catch branch in extractSubjectFromPem.
    // We can't call extractSubjectFromPem directly (not exported), but we can
    // trigger it via generateHostCertificate with an invalid CA cert PEM.
    // The function catches and returns a generic issuer, so cert generation
    // should still succeed.
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const caKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    // Use garbage as the CA cert — extractSubjectFromPem will hit catch branch
    const result = generateHostCertificate('fallback.test', 'NOT-A-VALID-PEM', caKeyPem);

    // Should still produce a certificate (using fallback issuer "AgenShield Proxy CA")
    expect(result.cert).toContain('-----BEGIN CERTIFICATE-----');
    expect(result.key).toContain('-----BEGIN PRIVATE KEY-----');
  });
});
