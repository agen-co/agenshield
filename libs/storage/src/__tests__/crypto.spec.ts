import { deriveKey, generateSalt, hashPasscode, verifyPasscode, encrypt, decrypt } from '../crypto';

describe('crypto', () => {
  describe('generateSalt', () => {
    it('returns a 32-byte buffer', () => {
      const salt = generateSalt();
      expect(salt).toBeInstanceOf(Buffer);
      expect(salt.length).toBe(32);
    });

    it('generates unique salts', () => {
      const a = generateSalt();
      const b = generateSalt();
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('deriveKey', () => {
    it('derives a 32-byte key from passcode + salt', () => {
      const salt = generateSalt();
      const key = deriveKey('my-passcode', salt);
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(32);
    });

    it('same passcode + salt produces same key', () => {
      const salt = generateSalt();
      const a = deriveKey('test', salt);
      const b = deriveKey('test', salt);
      expect(a.equals(b)).toBe(true);
    });

    it('different passcodes produce different keys', () => {
      const salt = generateSalt();
      const a = deriveKey('pass1', salt);
      const b = deriveKey('pass2', salt);
      expect(a.equals(b)).toBe(false);
    });

    it('different salts produce different keys', () => {
      const s1 = generateSalt();
      const s2 = generateSalt();
      const a = deriveKey('same', s1);
      const b = deriveKey('same', s2);
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('hashPasscode / verifyPasscode', () => {
    it('verifies correct passcode', () => {
      const salt = generateSalt();
      const hash = hashPasscode('secret', salt);
      expect(typeof hash).toBe('string');
      expect(verifyPasscode('secret', salt, hash)).toBe(true);
    });

    it('rejects wrong passcode', () => {
      const salt = generateSalt();
      const hash = hashPasscode('secret', salt);
      expect(verifyPasscode('wrong', salt, hash)).toBe(false);
    });
  });

  describe('encrypt / decrypt', () => {
    it('round-trips plaintext', () => {
      const salt = generateSalt();
      const key = deriveKey('pass', salt);
      const ciphertext = encrypt('hello world', key);
      expect(typeof ciphertext).toBe('string');
      expect(ciphertext).not.toBe('hello world');
      expect(decrypt(ciphertext, key)).toBe('hello world');
    });

    it('encrypts to different ciphertext each time (random IV)', () => {
      const salt = generateSalt();
      const key = deriveKey('pass', salt);
      const a = encrypt('same text', key);
      const b = encrypt('same text', key);
      expect(a).not.toBe(b);
    });

    it('fails to decrypt with wrong key', () => {
      const key1 = deriveKey('pass1', generateSalt());
      const key2 = deriveKey('pass2', generateSalt());
      const ciphertext = encrypt('secret data', key1);
      expect(() => decrypt(ciphertext, key2)).toThrow();
    });

    it('handles empty string', () => {
      const key = deriveKey('pass', generateSalt());
      const ciphertext = encrypt('', key);
      expect(decrypt(ciphertext, key)).toBe('');
    });

    it('handles unicode', () => {
      const key = deriveKey('pass', generateSalt());
      const text = 'Hello \u{1F600} World \u{1F30D}';
      const ciphertext = encrypt(text, key);
      expect(decrypt(ciphertext, key)).toBe(text);
    });

    it('throws on truncated ciphertext', () => {
      expect(() => decrypt('short', deriveKey('p', generateSalt()))).toThrow('Invalid ciphertext');
    });
  });
});
