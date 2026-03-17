/**
 * Tests for cloud auth primitives
 */

import {
  generateEd25519Keypair,
  createAgentSigHeader,
  parseAgentSigHeader,
  verifyAgentSig,
} from '../auth';

describe('Cloud auth', () => {
  describe('generateEd25519Keypair', () => {
    it('should return PEM-encoded public and private keys', () => {
      const kp = generateEd25519Keypair();
      expect(kp.publicKey).toContain('BEGIN PUBLIC KEY');
      expect(kp.privateKey).toContain('BEGIN PRIVATE KEY');
    });
  });

  describe('AgentSig', () => {
    let kp: { publicKey: string; privateKey: string };

    beforeEach(() => {
      kp = generateEd25519Keypair();
    });

    describe('createAgentSigHeader', () => {
      it('should produce AgentSig format', () => {
        const header = createAgentSigHeader('agent-1', kp.privateKey);
        expect(header).toMatch(/^AgentSig agent-1:\d+:.+$/);
      });
    });

    describe('parseAgentSigHeader', () => {
      it('should parse a valid header', () => {
        const header = createAgentSigHeader('agent-1', kp.privateKey);
        const parts = parseAgentSigHeader(header);
        expect(parts).not.toBeNull();
        expect(parts!.agentId).toBe('agent-1');
        expect(typeof parts!.timestamp).toBe('number');
        expect(parts!.signature).toBeInstanceOf(Buffer);
      });

      it('should return null for non-AgentSig header', () => {
        expect(parseAgentSigHeader('Bearer token')).toBeNull();
      });

      it('should return null for incomplete parts', () => {
        expect(parseAgentSigHeader('AgentSig agent-1:123')).toBeNull();
      });

      it('should return null for NaN timestamp', () => {
        expect(parseAgentSigHeader('AgentSig agent-1:abc:c2ln')).toBeNull();
      });
    });

    describe('verifyAgentSig', () => {
      it('should verify a valid signature', () => {
        const header = createAgentSigHeader('agent-1', kp.privateKey);
        const result = verifyAgentSig(header, kp.publicKey);
        expect(result).toBe('agent-1');
      });

      it('should reject malformed header', () => {
        expect(verifyAgentSig('garbage', kp.publicKey)).toBeNull();
      });

      it('should reject stale timestamp', () => {
        const { sign } = require('node:crypto');
        const oldTs = (Date.now() - 10 * 60 * 1000).toString();
        const data = Buffer.from(`agent-1:${oldTs}`);
        const sig = sign(null, data, kp.privateKey);
        const header = `AgentSig agent-1:${oldTs}:${sig.toString('base64')}`;

        expect(verifyAgentSig(header, kp.publicKey)).toBeNull();
      });

      it('should reject wrong public key', () => {
        const header = createAgentSigHeader('agent-1', kp.privateKey);
        const otherKp = generateEd25519Keypair();
        expect(verifyAgentSig(header, otherKp.publicKey)).toBeNull();
      });
    });
  });
});
