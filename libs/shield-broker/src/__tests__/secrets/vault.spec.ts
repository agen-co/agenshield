import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { SecretVault } from '../../secrets/vault.js';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'broker-vault-test-'));
}

describe('SecretVault', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createVault(): SecretVault {
    return new SecretVault({ vaultPath: path.join(tmpDir, 'vault.enc') });
  }

  describe('initialize()', () => {
    it('should create new encryption key when none exists', async () => {
      const vault = createVault();
      await vault.initialize();
      const keyPath = path.join(tmpDir, 'vault.key');
      expect(fs.existsSync(keyPath)).toBe(true);
    });

    it('should load existing encryption key', async () => {
      const vault1 = createVault();
      await vault1.initialize();
      await vault1.set('test', 'value');

      const vault2 = createVault();
      await vault2.initialize();
      const secret = await vault2.get('test');
      expect(secret?.value).toBe('value');
    });

    it('should create empty vault when file does not exist', async () => {
      const vault = createVault();
      await vault.initialize();
      const list = await vault.list();
      expect(list).toEqual([]);
    });
  });

  describe('set() / get() round-trip', () => {
    it('should encrypt and decrypt a secret correctly', async () => {
      const vault = createVault();
      await vault.initialize();
      await vault.set('API_KEY', 'my-secret-key-123');
      const result = await vault.get('API_KEY');
      expect(result).not.toBeNull();
      expect(result!.value).toBe('my-secret-key-123');
      expect(result!.name).toBe('API_KEY');
    });

    it('should return null for non-existent secret', async () => {
      const vault = createVault();
      await vault.initialize();
      const result = await vault.get('MISSING');
      expect(result).toBeNull();
    });

    it('should update accessCount on each get()', async () => {
      const vault = createVault();
      await vault.initialize();
      await vault.set('KEY', 'val');

      const first = await vault.get('KEY');
      expect(first!.accessCount).toBe(1);

      const second = await vault.get('KEY');
      expect(second!.accessCount).toBe(2);
    });

    it('should persist vault to disk after set()', async () => {
      const vault = createVault();
      await vault.initialize();
      await vault.set('KEY', 'val');

      const vaultPath = path.join(tmpDir, 'vault.enc');
      expect(fs.existsSync(vaultPath)).toBe(true);
      const content = JSON.parse(fs.readFileSync(vaultPath, 'utf-8'));
      expect(content.secrets.KEY).toBeDefined();
      expect(content.secrets.KEY.encrypted).toBeDefined();
    });
  });

  describe('delete()', () => {
    it('should return true and remove existing secret', async () => {
      const vault = createVault();
      await vault.initialize();
      await vault.set('KEY', 'val');
      expect(await vault.delete('KEY')).toBe(true);
      expect(await vault.get('KEY')).toBeNull();
    });

    it('should return false for non-existent secret', async () => {
      const vault = createVault();
      await vault.initialize();
      expect(await vault.delete('NOPE')).toBe(false);
    });
  });

  describe('list() / has()', () => {
    it('should list all secret names', async () => {
      const vault = createVault();
      await vault.initialize();
      await vault.set('A', '1');
      await vault.set('B', '2');
      const names = await vault.list();
      expect(names).toEqual(expect.arrayContaining(['A', 'B']));
    });

    it('should return true/false for has()', async () => {
      const vault = createVault();
      await vault.initialize();
      await vault.set('EXISTS', 'val');
      expect(await vault.has('EXISTS')).toBe(true);
      expect(await vault.has('MISSING')).toBe(false);
    });
  });

  describe('encryption', () => {
    it('should produce different IV each time (randomness)', async () => {
      const vault = createVault();
      await vault.initialize();
      await vault.set('KEY1', 'same-value');
      await vault.set('KEY2', 'same-value');

      const vaultPath = path.join(tmpDir, 'vault.enc');
      const content = JSON.parse(fs.readFileSync(vaultPath, 'utf-8'));
      expect(content.secrets.KEY1.iv).not.toBe(content.secrets.KEY2.iv);
    });

    it('should fail gracefully on tampered ciphertext', async () => {
      const vault = createVault();
      await vault.initialize();
      await vault.set('KEY', 'val');

      // Tamper with the encrypted data
      const vaultPath = path.join(tmpDir, 'vault.enc');
      const content = JSON.parse(fs.readFileSync(vaultPath, 'utf-8'));
      content.secrets.KEY.encrypted = 'dGFtcGVyZWQ='; // "tampered" in base64
      fs.writeFileSync(vaultPath, JSON.stringify(content));

      // Reload vault
      const vault2 = createVault();
      await vault2.initialize();
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      const result = await vault2.get('KEY');
      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe('auto-initialize', () => {
    it('get() should auto-initialize if not yet loaded', async () => {
      const vault = createVault();
      // Don't call initialize() — get() should auto-init
      const result = await vault.get('MISSING');
      expect(result).toBeNull();
    });

    it('set() should auto-initialize if not yet loaded', async () => {
      const vault = createVault();
      await vault.set('KEY', 'val');
      const result = await vault.get('KEY');
      expect(result!.value).toBe('val');
    });

    it('delete() should auto-initialize if not yet loaded', async () => {
      const vault = createVault();
      // Don't call initialize() — delete() should auto-init
      const result = await vault.delete('MISSING');
      expect(result).toBe(false);
    });

    it('list() should auto-initialize if not yet loaded', async () => {
      const vault = createVault();
      const result = await vault.list();
      expect(result).toEqual([]);
    });

    it('has() should auto-initialize if not yet loaded', async () => {
      const vault = createVault();
      const result = await vault.has('MISSING');
      expect(result).toBe(false);
    });
  });

  describe('encrypt/decrypt without init', () => {
    it('encrypt() should throw when vault not initialized', () => {
      const vault = createVault();
      expect(() => (vault as any).encrypt('test')).toThrow('Vault not initialized');
    });

    it('decrypt() should throw when vault not initialized', () => {
      const vault = createVault();
      expect(() => (vault as any).decrypt('enc', 'iv', 'tag')).toThrow('Vault not initialized');
    });
  });
});
