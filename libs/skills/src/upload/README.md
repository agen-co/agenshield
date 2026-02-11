# Upload Service

Create skills from file arrays. Computes deterministic content hashes and registers file metadata.

## Data Flow

```mermaid
graph LR
    UF[uploadFromFiles] --> HF[Hash Files SHA-256]
    HF --> CH[Compute Content Hash]
    CH --> CS[Create/Reuse Skill by Slug]
    CS --> AV[Add Version]
    AV --> RF[Register Files]
    RF --> E[Emit Events]
```

## Public API

| Method | Signature | Description |
|--------|-----------|-------------|
| `uploadFromFiles` | `(params: UploadFromZipParams) => UploadResult` | Create skill + version from file buffers |

## Types

```typescript
interface UploadFromZipParams {
  name: string;
  slug: string;
  version: string;
  author?: string;
  description?: string;
  tags?: string[];
  files: Array<{ relativePath: string; content: Buffer }>;
}

interface UploadResult {
  skill: Skill;
  version: SkillVersion;
}
```

## Content Hash

The content hash is deterministic and order-independent:
1. Each file is hashed individually with SHA-256
2. File hashes are sorted by `relativePath`
3. Sorted hashes are concatenated and hashed again with SHA-256
