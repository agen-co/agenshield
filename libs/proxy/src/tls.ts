/**
 * TLS certificate generation and caching for SSL termination.
 *
 * When SSL termination is enabled, the proxy acts as a MITM for CONNECT tunnels:
 * it generates per-host leaf certificates signed by the configured CA, allowing
 * it to decrypt, inspect, and re-encrypt HTTPS traffic for full URL policy checks.
 */

import * as crypto from 'node:crypto';
import * as tls from 'node:tls';

export interface GeneratedCert {
  cert: string;
  key: string;
}

/**
 * LRU cache for generated per-host TLS certificates.
 * Avoids regenerating certificates for frequently accessed hosts.
 */
export class CertificateCache {
  private cache = new Map<string, GeneratedCert>();
  private maxSize: number;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  get(hostname: string): GeneratedCert | undefined {
    const entry = this.cache.get(hostname);
    if (entry) {
      // Move to end (most recently used)
      this.cache.delete(hostname);
      this.cache.set(hostname, entry);
    }
    return entry;
  }

  set(hostname: string, cert: GeneratedCert): void {
    if (this.cache.has(hostname)) {
      this.cache.delete(hostname);
    } else if (this.cache.size >= this.maxSize) {
      // Evict the least recently used (first entry)
      const firstKey = this.cache.keys().next().value as string;
      this.cache.delete(firstKey);
    }
    this.cache.set(hostname, cert);
  }

  get size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

/**
 * Generate a short-lived leaf certificate for a hostname, signed by the given CA.
 * The certificate includes the hostname as a Subject Alternative Name (SAN).
 */
export function generateHostCertificate(
  hostname: string,
  caCert: string,
  caKey: string,
): GeneratedCert {
  // Generate a new key pair for the leaf certificate
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });

  // Create a self-signed cert first, then we'll use TLS context with the CA
  const cert = crypto.X509Certificate
    ? createSignedCert(hostname, privateKey, publicKey, caCert, caKey)
    : createFallbackCert(hostname, privateKey, caCert, caKey);

  return {
    cert,
    key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

function createSignedCert(
  hostname: string,
  leafKey: crypto.KeyObject,
  leafPubKey: crypto.KeyObject,
  caCertPem: string,
  caKeyPem: string,
): string {
  // Use node:crypto to create a CSR-like flow
  // We generate a leaf cert signed by the CA using the createCertificate approach
  const serialNumber = crypto.randomBytes(16).toString('hex');

  // Build a minimal X.509 certificate using ASN.1 DER encoding
  // This is a simplified approach that works with Node.js built-in modules
  const leafPubKeyDer = leafPubKey.export({ type: 'spki', format: 'der' });

  // Parse CA key for signing
  const caPrivateKey = crypto.createPrivateKey(caKeyPem);

  // Create a TBS (To-Be-Signed) certificate structure
  const now = new Date();
  const notBefore = now;
  const notAfter = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  // Build the certificate using ASN.1
  const tbsCert = buildTbsCertificate({
    serialNumber,
    issuer: extractSubjectFromPem(caCertPem),
    subject: `CN=${hostname}`,
    notBefore,
    notAfter,
    publicKeyDer: leafPubKeyDer,
    hostname,
  });

  // Sign the TBS certificate with the CA key
  const sign = crypto.createSign('SHA256');
  sign.update(tbsCert);
  const signature = sign.sign(caPrivateKey);

  // Build the full certificate DER
  const certDer = buildFullCertificate(tbsCert, signature);

  // Convert to PEM
  const certBase64 = certDer.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < certBase64.length; i += 64) {
    lines.push(certBase64.slice(i, i + 64));
  }
  return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`;
}

function createFallbackCert(
  hostname: string,
  leafKey: crypto.KeyObject,
  caCertPem: string,
  caKeyPem: string,
): string {
  // Fallback for older Node.js versions without X509Certificate
  return createSignedCert(
    hostname,
    leafKey,
    crypto.createPublicKey(leafKey),
    caCertPem,
    caKeyPem,
  );
}

// --- ASN.1 DER encoding helpers ---

function encodeLength(length: number): Buffer {
  if (length < 0x80) {
    return Buffer.from([length]);
  }
  const bytes: number[] = [];
  let temp = length;
  while (temp > 0) {
    bytes.unshift(temp & 0xff);
    temp >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function encodeSequence(...items: Buffer[]): Buffer {
  const content = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x30]), encodeLength(content.length), content]);
}

function encodeSet(...items: Buffer[]): Buffer {
  const content = Buffer.concat(items);
  return Buffer.concat([Buffer.from([0x31]), encodeLength(content.length), content]);
}

function encodeOid(oid: number[]): Buffer {
  const bytes: number[] = [];
  bytes.push(oid[0] * 40 + oid[1]);
  for (let i = 2; i < oid.length; i++) {
    let value = oid[i];
    if (value >= 0x80) {
      const encoded: number[] = [];
      encoded.unshift(value & 0x7f);
      value >>= 7;
      while (value > 0) {
        encoded.unshift(0x80 | (value & 0x7f));
        value >>= 7;
      }
      bytes.push(...encoded);
    } else {
      bytes.push(value);
    }
  }
  const content = Buffer.from(bytes);
  return Buffer.concat([Buffer.from([0x06]), encodeLength(content.length), content]);
}

function encodeUtf8String(str: string): Buffer {
  const content = Buffer.from(str, 'utf-8');
  return Buffer.concat([Buffer.from([0x0c]), encodeLength(content.length), content]);
}

function encodeInteger(value: Buffer | number): Buffer {
  let buf: Buffer;
  if (typeof value === 'number') {
    if (value === 0) {
      buf = Buffer.from([0]);
    } else {
      const bytes: number[] = [];
      let temp = value;
      while (temp > 0) {
        bytes.unshift(temp & 0xff);
        temp >>= 8;
      }
      if (bytes[0] & 0x80) bytes.unshift(0);
      buf = Buffer.from(bytes);
    }
  } else {
    buf = value[0] & 0x80 ? Buffer.concat([Buffer.from([0]), value]) : value;
  }
  return Buffer.concat([Buffer.from([0x02]), encodeLength(buf.length), buf]);
}

function encodeBitString(content: Buffer): Buffer {
  // Prepend unused bits count (0)
  const withPad = Buffer.concat([Buffer.from([0x00]), content]);
  return Buffer.concat([Buffer.from([0x03]), encodeLength(withPad.length), withPad]);
}

function encodeContextTag(tagNumber: number, content: Buffer, constructed = true): Buffer {
  const tag = (constructed ? 0xa0 : 0x80) | tagNumber;
  return Buffer.concat([Buffer.from([tag]), encodeLength(content.length), content]);
}

function encodeGeneralizedTime(date: Date): Buffer {
  const str = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  const content = Buffer.from(str, 'ascii');
  return Buffer.concat([Buffer.from([0x18]), encodeLength(content.length), content]);
}

function encodeOctetString(content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), encodeLength(content.length), content]);
}

interface TbsCertParams {
  serialNumber: string;
  issuer: Buffer;
  subject: string;
  notBefore: Date;
  notAfter: Date;
  publicKeyDer: Buffer;
  hostname: string;
}

function buildTbsCertificate(params: TbsCertParams): Buffer {
  const { serialNumber, issuer, subject, notBefore, notAfter, publicKeyDer, hostname } = params;

  // Version: v3 (value 2)
  const version = encodeContextTag(0, encodeInteger(2));

  // Serial number
  const serial = encodeInteger(Buffer.from(serialNumber, 'hex'));

  // Signature algorithm: SHA256 with RSA
  const sha256WithRsa = encodeSequence(
    encodeOid([1, 2, 840, 113549, 1, 1, 11]), // sha256WithRSAEncryption
    Buffer.from([0x05, 0x00]), // NULL
  );

  // Validity
  const validity = encodeSequence(
    encodeGeneralizedTime(notBefore),
    encodeGeneralizedTime(notAfter),
  );

  // Subject: CN=hostname
  const cn = subject.startsWith('CN=') ? subject.slice(3) : subject;
  const subjectName = encodeSequence(
    encodeSet(
      encodeSequence(
        encodeOid([2, 5, 4, 3]), // commonName
        encodeUtf8String(cn),
      ),
    ),
  );

  // Subject public key info (already DER-encoded from SPKI export)
  const subjectPubKeyInfo = publicKeyDer;

  // Extensions: Subject Alternative Name
  const sanExtension = buildSanExtension(hostname);
  const extensions = encodeContextTag(3, encodeSequence(sanExtension));

  return encodeSequence(
    version,
    serial,
    sha256WithRsa,
    issuer,
    validity,
    subjectName,
    subjectPubKeyInfo,
    extensions,
  );
}

function buildSanExtension(hostname: string): Buffer {
  // SAN OID: 2.5.29.17
  const sanOid = encodeOid([2, 5, 29, 17]);

  // DNS name (context tag 2, primitive)
  const dnsName = Buffer.concat([
    Buffer.from([0x82]),
    encodeLength(hostname.length),
    Buffer.from(hostname, 'ascii'),
  ]);

  const sanValue = encodeOctetString(encodeSequence(dnsName));

  return encodeSequence(sanOid, sanValue);
}

function buildFullCertificate(tbsCert: Buffer, signature: Buffer): Buffer {
  // Signature algorithm: SHA256 with RSA
  const sha256WithRsa = encodeSequence(
    encodeOid([1, 2, 840, 113549, 1, 1, 11]),
    Buffer.from([0x05, 0x00]),
  );

  return encodeSequence(
    tbsCert,
    sha256WithRsa,
    encodeBitString(signature),
  );
}

function extractSubjectFromPem(pem: string): Buffer {
  try {
    const x509 = new crypto.X509Certificate(pem);
    // Parse the subject string (e.g., "CN=AgenShield CA")
    const subject = x509.subject;
    const cn = subject.match(/CN=([^,\n]+)/)?.[1] || 'Unknown CA';

    return encodeSequence(
      encodeSet(
        encodeSequence(
          encodeOid([2, 5, 4, 3]), // commonName
          encodeUtf8String(cn),
        ),
      ),
    );
  } catch {
    // Fallback: use a generic issuer
    return encodeSequence(
      encodeSet(
        encodeSequence(
          encodeOid([2, 5, 4, 3]),
          encodeUtf8String('AgenShield Proxy CA'),
        ),
      ),
    );
  }
}

/**
 * Create a TLS secure context for the proxy acting as a TLS server to the client.
 * Uses the generated per-host certificate.
 */
export function createHostTlsContext(cert: GeneratedCert, caCert: string): tls.SecureContext {
  return tls.createSecureContext({
    key: cert.key,
    cert: cert.cert,
    ca: caCert,
  });
}
