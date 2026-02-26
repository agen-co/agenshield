/**
 * Binary signature types
 *
 * Used for anti-rename process detection via binary fingerprinting.
 * Signatures map SHA256 hashes of known binaries to their package names,
 * enabling detection of renamed executables.
 */

export interface BinarySignature {
  id: string;
  sha256: string;
  packageName: string;
  version?: string;
  platform?: string;
  source: 'cloud' | 'local';
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBinarySignatureInput {
  sha256: string;
  packageName: string;
  version?: string;
  platform?: string;
  source?: 'cloud' | 'local';
  metadata?: Record<string, unknown>;
}

export interface BinarySignatureSyncRequest {
  signatures: CreateBinarySignatureInput[];
}

export interface BinarySignatureSyncResponse {
  count: number;
}
