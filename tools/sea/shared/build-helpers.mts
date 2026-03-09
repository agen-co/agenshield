/**
 * Shared SEA build helpers.
 *
 * Functions for SEA blob generation, postject injection, code signing,
 * and archive packaging — shared across all binary app builds.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { ROOT, DIST_SEA, resolveCodesignId } from './constants.mts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function run(cmd: string, label: string, opts?: { cwd?: string; timeout?: number }): void {
  console.log(`\n[${'='.repeat(60)}]`);
  console.log(`[STEP] ${label}`);
  console.log(`[CMD]  ${cmd}`);
  console.log(`[${'='.repeat(60)}]\n`);

  execSync(cmd, {
    cwd: opts?.cwd ?? ROOT,
    stdio: 'inherit',
    timeout: opts?.timeout ?? 300_000,
    env: {
      ...process.env,
      FORCE_COLOR: '1',
    },
  });
}

export function getVersion(): string {
  const pkgPath = path.join(ROOT, 'libs', 'cli', 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0-dev';
  } catch {
    return '0.0.0-dev';
  }
}

// ---------------------------------------------------------------------------
// Code signing identity resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the codesign identity to use for signing macOS binaries.
 *
 * Resolution priority:
 * 1. Explicit parameter (from --codesign-identity flag)
 * 2. AGENSHIELD_CODESIGN_IDENTITY env var
 * 3. APPLE_TEAM_ID + APPLE_CODESIGN_ORG env vars → constructs "Developer ID Application: $ORG ($TEAM_ID)"
 * 4. null (ad-hoc signing)
 */

/**
 * Check whether a signing identity exists in the keychain.
 */
function hasIdentity(identity: string): boolean {
  try {
    const result = execSync(
      `security find-identity -v -p codesigning`,
      { encoding: 'utf-8', timeout: 10_000 },
    );
    return result.includes(identity);
  } catch {
    return false;
  }
}

export function resolveCodesignIdentity(explicit?: string): string | null {
  if (explicit) return explicit;

  const envIdentity = process.env['AGENSHIELD_CODESIGN_IDENTITY'];
  if (envIdentity) return envIdentity;

  const teamId = process.env['APPLE_TEAM_ID'];
  const orgName = process.env['APPLE_CODESIGN_ORG'];
  if (!teamId || !orgName) return null;

  const identity = `Developer ID Application: ${orgName} (${teamId})`;
  if (hasIdentity(identity)) return identity;

  console.log(`[WARN] Codesign identity "${identity}" not found in keychain — will ad-hoc sign`);
  return null;
}

// ---------------------------------------------------------------------------
// SEA blob generation
// ---------------------------------------------------------------------------

/**
 * Generate a SEA blob from a sea-config.json file.
 */
export function generateSEABlob(seaConfigPath: string): void {
  run(
    `node --experimental-sea-config "${seaConfigPath}"`,
    `Generate SEA blob from ${path.basename(seaConfigPath)}`,
  );
}

// ---------------------------------------------------------------------------
// Blob injection
// ---------------------------------------------------------------------------

export interface InjectOptions {
  binaryPath: string;
  blobPath: string;
  platform?: string;
  /** Code signing identity (e.g. "Developer ID Application: ..."). When absent, ad-hoc signing is used. */
  codesignIdentity?: string;
  /** Path to entitlements.plist for hardened runtime. Used with both real and ad-hoc signing. */
  entitlementsPath?: string;
}

/**
 * Copy the Node binary, remove existing signature, inject SEA blob, re-sign.
 *
 * Signing modes:
 * - No identity → `codesign --sign - --options runtime --entitlements` (ad-hoc with hardened runtime)
 * - Identity provided → `codesign --sign "Developer ID..." --timestamp --options runtime --entitlements`
 */
export function injectBlob(opts: InjectOptions): void {
  const { binaryPath, blobPath, platform = os.platform(), codesignIdentity, entitlementsPath } = opts;

  // Copy the node binary
  const nodePath = process.execPath;
  console.log(`[COPY] ${nodePath} → ${binaryPath}`);
  fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
  fs.copyFileSync(nodePath, binaryPath);
  fs.chmodSync(binaryPath, 0o755);

  // macOS: remove existing code signature before injection
  if (platform === 'darwin') {
    try {
      run(
        `codesign --remove-signature "${binaryPath}"`,
        'Remove existing code signature (macOS)',
      );
    } catch {
      console.log('[WARN] codesign --remove-signature failed (may not be signed)');
    }
  }

  if (platform === 'linux') {
    // Linux: bypass postject. LIEF's ELF reconstruction duplicates the sentinel
    // in rebuilt string tables, causing postject's uniqueness check to fail on
    // Node.js v24. Use objcopy to add the section + binary-patch the fuse.
    injectBlobLinux(binaryPath, blobPath);
  } else if (platform === 'darwin') {
    // macOS: direct Mach-O patching — bypasses postject/LIEF to avoid
    // sentinel duplication issues in Node.js v24.
    injectBlobDarwin(binaryPath, blobPath);
  } else {
    // Windows or other: use postject
    run(
      `npx postject "${binaryPath}" NODE_SEA_BLOB "${blobPath}" ` +
      `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
      'Inject SEA blob into binary',
    );
  }

  // macOS: code signing
  if (platform === 'darwin') {
    codesignBinary(binaryPath, codesignIdentity, entitlementsPath);
  }

  // Post-injection validation: ensure binary runs
  validateBinary(binaryPath);
}

/**
 * Sign a binary with the given identity, or ad-hoc if none provided.
 * Both modes use hardened runtime + entitlements (required for macOS Sequoia).
 *
 * @param identifier — Explicit bundle identifier for --identifier flag.
 *   When omitted, auto-resolved from the binary filename via resolveCodesignId().
 */
export function codesignBinary(
  binaryPath: string,
  identity?: string,
  entitlementsPath?: string,
  identifier?: string,
): void {
  const resolvedIdentity = identity ?? resolveCodesignIdentity();
  const resolvedId = identifier ?? resolveCodesignId(binaryPath);
  const idFlag = resolvedId ? ` --identifier "${resolvedId}"` : '';

  if (resolvedIdentity) {
    const defaultEntitlements = path.join(ROOT, 'tools', 'sea', 'entitlements.plist');
    const resolvedEntitlements = entitlementsPath ?? defaultEntitlements;
    const entitlementFlag = fs.existsSync(resolvedEntitlements)
      ? ` --entitlements "${resolvedEntitlements}"`
      : '';
    run(
      `codesign --force --sign "${resolvedIdentity}"${idFlag} --timestamp --options runtime${entitlementFlag} "${binaryPath}"`,
      `Code signing with identity: ${resolvedIdentity.slice(0, 40)}...`,
    );
  } else {
    const defaultEntitlements = path.join(ROOT, 'tools', 'sea', 'entitlements.plist');
    const resolvedEntitlements = entitlementsPath ?? defaultEntitlements;
    if (fs.existsSync(resolvedEntitlements)) {
      run(
        `codesign --force --sign -${idFlag} --options runtime --entitlements "${resolvedEntitlements}" "${binaryPath}"`,
        'Ad-hoc code signing with hardened runtime (macOS)',
      );
    } else {
      console.log('[WARN] Entitlements plist not found — falling back to plain ad-hoc signing');
      run(
        `codesign --force --sign -${idFlag} "${binaryPath}"`,
        'Ad-hoc code signing (macOS)',
      );
    }
  }
}

/**
 * Inject SEA blob on Linux without postject.
 *
 * postject uses LIEF internally, which reconstructs the ELF binary in memory
 * and re-introduces copies of the sentinel string in rebuilt string tables.
 * postject's uniqueness check then fails. This function bypasses postject/LIEF
 * entirely:
 *   1. `objcopy --add-section` adds the blob as a named ELF section
 *   2. Binary-patch the fuse: find `SENTINEL:0` → change to `SENTINEL:1`
 *
 * Node.js SEA runtime reads `/proc/self/exe`, walks ELF section headers,
 * and looks up sections by name — section type doesn't matter.
 */
function injectBlobLinux(binaryPath: string, blobPath: string): void {
  const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

  // Step 1: Add the blob as an ELF section
  run(
    `objcopy --add-section NODE_SEA_BLOB="${blobPath}" --set-section-flags NODE_SEA_BLOB=noload,readonly "${binaryPath}"`,
    'Inject SEA blob via objcopy (Linux)',
  );

  // Step 2: Flip the fuse from :0 to :1
  const fuseBefore = Buffer.from(`${SENTINEL}:0`);
  const fuseAfter  = Buffer.from(`${SENTINEL}:1`);
  const buf = fs.readFileSync(binaryPath);
  const idx = buf.indexOf(fuseBefore);

  if (idx === -1) {
    throw new Error(`[FUSE] Could not find "${SENTINEL}:0" in ${binaryPath}`);
  }

  fuseAfter.copy(buf, idx);
  fs.writeFileSync(binaryPath, buf);
  console.log(`[FUSE] Flipped fuse at offset 0x${idx.toString(16)}`);
}

/**
 * Add a segment + section to a Mach-O 64-bit binary.
 *
 * Performs direct binary surgery: appends blob data at a page-aligned offset,
 * then writes an LC_SEGMENT_64 load command (with one section_64) into the
 * padding between the header and the first segment's file data.
 *
 * This bypasses postject/LIEF entirely — LIEF deserializes and re-serializes
 * the binary, creating NEW sentinel duplicates that break postject's uniqueness
 * check. Direct patching avoids this problem.
 */
function addMachOSection(
  bin: Buffer,
  segmentName: string,
  sectionName: string,
  data: Buffer,
): Buffer {
  // ── Mach-O constants ──────────────────────────────────────────────────────
  const MH_MAGIC_64   = 0xFEEDFACF;
  const LC_SEGMENT_64  = 0x19;
  const VM_PROT_READ   = 0x01;

  // Load command types that reference offsets into __LINKEDIT
  const LC_SYMTAB              = 0x02;
  const LC_DYSYMTAB            = 0x0B;
  const LC_CODE_SIGNATURE      = 0x1D;
  const LC_SEGMENT_SPLIT_INFO  = 0x1E;
  const LC_DYLD_INFO           = 0x22;
  const LC_FUNCTION_STARTS     = 0x26;
  const LC_DATA_IN_CODE        = 0x29;
  const LC_DYLD_INFO_ONLY      = 0x80000022;
  const LC_DYLD_EXPORTS_TRIE   = 0x80000033;
  const LC_DYLD_CHAINED_FIXUPS = 0x80000034;

  // arm64 page size = 16KB (macOS on Apple Silicon)
  const PAGE_SIZE      = 16384;

  // LC_SEGMENT_64 = 72 bytes, section_64 = 80 bytes
  const SEGMENT_CMD_SIZE = 72;
  const SECTION_SIZE     = 80;
  const NEW_CMD_SIZE     = SEGMENT_CMD_SIZE + SECTION_SIZE; // 152

  /** Shift a uint32 field by delta if it is non-zero. */
  function shiftU32(buf: Buffer, off: number, delta: number): void {
    const v = buf.readUInt32LE(off);
    if (v !== 0) buf.writeUInt32LE(v + delta, off);
  }

  // ── 1. Validate header ────────────────────────────────────────────────────
  const magic = bin.readUInt32LE(0);
  if (magic !== MH_MAGIC_64) {
    throw new Error(
      `[MACHO] Not a 64-bit Mach-O binary (magic=0x${magic.toString(16)}). ` +
      `Fat/universal binaries are not supported — use lipo to extract a single arch first.`
    );
  }

  const ncmds      = bin.readUInt32LE(16);
  const sizeofcmds = bin.readUInt32LE(20);
  const headerSize = 32; // mach_header_64 size

  // ── 2. Parse load commands ────────────────────────────────────────────────
  //    Find __LINKEDIT, track max VM end, earliest data offset, and record
  //    all load commands whose offset fields point into __LINKEDIT.
  let minDataOffset = Infinity; // earliest fileoff with data
  let maxVmEnd      = 0n;      // highest vmaddr + vmsize

  // __LINKEDIT tracking
  let linkeditCmdOffset = -1;
  let linkeditFileoff   = 0n;
  let linkeditFilesize  = 0n;

  // Commands with offset fields that reference __LINKEDIT data
  const linkeditRefCmds: { cmdOffset: number; cmd: number }[] = [];

  let cmdOffset = headerSize;
  for (let i = 0; i < ncmds; i++) {
    const cmd     = bin.readUInt32LE(cmdOffset);
    const cmdsize = bin.readUInt32LE(cmdOffset + 4);

    if (cmd === LC_SEGMENT_64) {
      const segname = bin.toString('ascii', cmdOffset + 8, cmdOffset + 24).replace(/\0+$/, '');
      const fileoff  = bin.readBigUInt64LE(cmdOffset + 40);
      const vmaddr   = bin.readBigUInt64LE(cmdOffset + 24);
      const vmsize   = bin.readBigUInt64LE(cmdOffset + 32);

      if (fileoff > 0n && Number(fileoff) < minDataOffset) {
        minDataOffset = Number(fileoff);
      }

      const vmEnd = vmaddr + vmsize;
      if (vmEnd > maxVmEnd) maxVmEnd = vmEnd;

      if (segname === '__LINKEDIT') {
        linkeditCmdOffset = cmdOffset;
        linkeditFileoff   = fileoff;
        linkeditFilesize  = bin.readBigUInt64LE(cmdOffset + 48);
      }
    }

    // Record commands that contain file offset fields pointing into __LINKEDIT
    if (
      cmd === LC_SYMTAB || cmd === LC_DYSYMTAB ||
      cmd === LC_DYLD_INFO || cmd === LC_DYLD_INFO_ONLY ||
      cmd === LC_CODE_SIGNATURE || cmd === LC_SEGMENT_SPLIT_INFO ||
      cmd === LC_FUNCTION_STARTS || cmd === LC_DATA_IN_CODE ||
      cmd === LC_DYLD_EXPORTS_TRIE || cmd === LC_DYLD_CHAINED_FIXUPS
    ) {
      linkeditRefCmds.push({ cmdOffset, cmd });
    }

    cmdOffset += cmdsize;
  }

  if (linkeditCmdOffset === -1) {
    throw new Error('[MACHO] __LINKEDIT segment not found — cannot inject blob');
  }

  // ── 3. Verify space for new load command ──────────────────────────────────
  const cmdsEnd = headerSize + sizeofcmds;
  const available = minDataOffset - cmdsEnd;
  if (available < NEW_CMD_SIZE) {
    throw new Error(
      `[MACHO] Not enough padding for new load command: need ${NEW_CMD_SIZE} bytes, ` +
      `only ${available} available between load commands end (0x${cmdsEnd.toString(16)}) ` +
      `and first segment data (0x${minDataOffset.toString(16)})`
    );
  }

  // ── 4. Compute blob placement — INSERT BEFORE __LINKEDIT ──────────────────
  //
  // macOS codesign strict validation requires __LINKEDIT to be the last
  // segment by file offset (the code signature lives inside __LINKEDIT).
  // We insert the blob at __LINKEDIT's current fileoff and shift __LINKEDIT
  // forward by the page-aligned blob size.
  //
  // Before: [header] [__TEXT] [__DATA_CONST] [__DATA] [__LINKEDIT]
  // After:  [header] [__TEXT] [__DATA_CONST] [__DATA] [NODE_SEA blob] [__LINKEDIT]

  const insertOffset   = Number(linkeditFileoff);  // already page-aligned
  const alignedBlobSize = Math.ceil(data.length / PAGE_SIZE) * PAGE_SIZE;
  const linkeditSize   = Number(linkeditFilesize);
  const blobSize       = data.length;
  const totalSize      = insertOffset + alignedBlobSize + linkeditSize;
  const newVmAddr      = (maxVmEnd + BigInt(PAGE_SIZE) - 1n) / BigInt(PAGE_SIZE) * BigInt(PAGE_SIZE);

  // ── 5. Build output buffer ────────────────────────────────────────────────
  const result = Buffer.alloc(totalSize);
  // Everything before __LINKEDIT (unchanged)
  bin.copy(result, 0, 0, insertOffset);
  // Blob data at insertOffset
  data.copy(result, insertOffset);
  // __LINKEDIT data shifted forward by alignedBlobSize
  bin.copy(result, insertOffset + alignedBlobSize, insertOffset, insertOffset + linkeditSize);

  // ── 6. Update __LINKEDIT fileoff ──────────────────────────────────────────
  result.writeBigUInt64LE(BigInt(insertOffset + alignedBlobSize), linkeditCmdOffset + 40);

  // ── 7. Shift all __LINKEDIT-referencing offset fields ─────────────────────
  for (const { cmdOffset: off, cmd } of linkeditRefCmds) {
    switch (cmd) {
      case LC_SYMTAB:
        // +8: symoff, +16: stroff
        shiftU32(result, off + 8, alignedBlobSize);
        shiftU32(result, off + 16, alignedBlobSize);
        break;
      case LC_DYSYMTAB:
        // +32: tocoff, +40: modtaboff, +48: extrefsymoff,
        // +56: indirectsymoff, +64: extreloff, +72: locreloff
        shiftU32(result, off + 32, alignedBlobSize);
        shiftU32(result, off + 40, alignedBlobSize);
        shiftU32(result, off + 48, alignedBlobSize);
        shiftU32(result, off + 56, alignedBlobSize);
        shiftU32(result, off + 64, alignedBlobSize);
        shiftU32(result, off + 72, alignedBlobSize);
        break;
      case LC_DYLD_INFO:
      case LC_DYLD_INFO_ONLY:
        // +8: rebase_off, +16: bind_off, +24: weak_bind_off,
        // +32: lazy_bind_off, +40: export_off
        shiftU32(result, off + 8, alignedBlobSize);
        shiftU32(result, off + 16, alignedBlobSize);
        shiftU32(result, off + 24, alignedBlobSize);
        shiftU32(result, off + 32, alignedBlobSize);
        shiftU32(result, off + 40, alignedBlobSize);
        break;
      case LC_CODE_SIGNATURE:
      case LC_SEGMENT_SPLIT_INFO:
      case LC_FUNCTION_STARTS:
      case LC_DATA_IN_CODE:
      case LC_DYLD_EXPORTS_TRIE:
      case LC_DYLD_CHAINED_FIXUPS:
        // +8: dataoff
        shiftU32(result, off + 8, alignedBlobSize);
        break;
    }
  }

  // ── 8. Write LC_SEGMENT_64 at end of existing commands ────────────────────
  const newCmdOffset = cmdsEnd;
  const w = result;

  // segment_command_64 (72 bytes)
  w.writeUInt32LE(LC_SEGMENT_64, newCmdOffset);           // cmd
  w.writeUInt32LE(NEW_CMD_SIZE, newCmdOffset + 4);         // cmdsize
  w.write(segmentName.padEnd(16, '\0'), newCmdOffset + 8, 16, 'ascii');  // segname
  w.writeBigUInt64LE(newVmAddr, newCmdOffset + 24);        // vmaddr
  w.writeBigUInt64LE(BigInt(blobSize), newCmdOffset + 32); // vmsize
  w.writeBigUInt64LE(BigInt(insertOffset), newCmdOffset + 40); // fileoff — at insertion point
  w.writeBigUInt64LE(BigInt(blobSize), newCmdOffset + 48); // filesize
  w.writeInt32LE(VM_PROT_READ, newCmdOffset + 56);         // maxprot
  w.writeInt32LE(VM_PROT_READ, newCmdOffset + 60);         // initprot
  w.writeUInt32LE(1, newCmdOffset + 64);                   // nsects
  w.writeUInt32LE(0, newCmdOffset + 68);                   // flags

  // section_64 (80 bytes) — immediately after segment command
  const secOffset = newCmdOffset + SEGMENT_CMD_SIZE;
  w.write(sectionName.padEnd(16, '\0'), secOffset, 16, 'ascii');       // sectname
  w.write(segmentName.padEnd(16, '\0'), secOffset + 16, 16, 'ascii');  // segname
  w.writeBigUInt64LE(newVmAddr, secOffset + 32);           // addr
  w.writeBigUInt64LE(BigInt(blobSize), secOffset + 40);    // size
  w.writeUInt32LE(insertOffset, secOffset + 48);           // offset — at insertion point
  w.writeUInt32LE(0, secOffset + 52);                      // align
  w.writeUInt32LE(0, secOffset + 56);                      // reloff
  w.writeUInt32LE(0, secOffset + 60);                      // nreloc
  w.writeUInt32LE(0, secOffset + 64);                      // flags
  w.writeUInt32LE(0, secOffset + 68);                      // reserved1
  w.writeUInt32LE(0, secOffset + 72);                      // reserved2
  w.writeUInt32LE(0, secOffset + 76);                      // reserved3 (padding to 80)

  // ── 9. Update header ──────────────────────────────────────────────────────
  w.writeUInt32LE(ncmds + 1, 16);                          // ncmds
  w.writeUInt32LE(sizeofcmds + NEW_CMD_SIZE, 20);          // sizeofcmds

  console.log(`[MACHO] Added segment "${segmentName}" section "${sectionName}": ` +
    `fileoff=0x${insertOffset.toString(16)}, size=${blobSize}, vmaddr=0x${newVmAddr.toString(16)}, ` +
    `__LINKEDIT shifted by 0x${alignedBlobSize.toString(16)} to fileoff=0x${(insertOffset + alignedBlobSize).toString(16)}`);

  return result;
}

/**
 * Inject SEA blob on macOS via direct Mach-O binary patching.
 *
 * Bypasses postject/LIEF entirely to avoid sentinel duplication issues:
 *   1. addMachOSection() writes an LC_SEGMENT_64 + section_64 with the blob
 *   2. Binary-patch the fuse: find `SENTINEL:0` → change to `SENTINEL:1`
 *
 * Node.js SEA runtime uses getsectiondata("NODE_SEA", "NODE_SEA_BLOB", &size)
 * which only needs a valid LC_SEGMENT_64 with matching names and correct offsets.
 */
function injectBlobDarwin(binaryPath: string, blobPath: string): void {
  const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
  const bin = fs.readFileSync(binaryPath);
  const blob = fs.readFileSync(blobPath);

  // Step 1: Inject blob as Mach-O section (no LIEF, no postject)
  const patched = addMachOSection(bin, 'NODE_SEA', 'NODE_SEA_BLOB', blob);

  // Step 2: Flip fuse :0 → :1
  const fuseBefore = Buffer.from(`${SENTINEL}:0`);
  const fuseAfter  = Buffer.from(`${SENTINEL}:1`);
  const idx = patched.indexOf(fuseBefore);
  if (idx === -1) {
    throw new Error(`[FUSE] Could not find "${SENTINEL}:0" in ${binaryPath}`);
  }
  fuseAfter.copy(patched, idx);

  fs.writeFileSync(binaryPath, patched);
  fs.chmodSync(binaryPath, 0o755);
  console.log(`[FUSE] Flipped fuse at offset 0x${idx.toString(16)}`);
}

/**
 * Post-injection validation: run the binary with --version to ensure it works.
 */
function validateBinary(binaryPath: string): void {
  try {
    const output = execSync(`"${binaryPath}" --version`, {
      encoding: 'utf-8',
      timeout: 10_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    console.log(`[VALIDATE] ${path.basename(binaryPath)} --version → ${output}`);
  } catch (err) {
    console.log(`[WARN] Post-injection validation failed for ${path.basename(binaryPath)}: ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Write VERSION file
// ---------------------------------------------------------------------------

/**
 * Write the VERSION file to a given output directory.
 */
export function writeVersionFile(outDir: string): string {
  const version = getVersion();
  const versionPath = path.join(outDir, 'VERSION');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(versionPath, version + '\n');
  console.log(`[VERSION] ${version} → ${versionPath}`);
  return version;
}

// ---------------------------------------------------------------------------
// Packaging
// ---------------------------------------------------------------------------

export interface PackageOptions {
  /** Paths to the final binaries (e.g. agenshield, agenshield-daemon, agenshield-broker) */
  binaries: { name: string; path: string }[];
  /** Platform (darwin, linux) */
  platform?: string;
  /** Architecture (arm64, x64) */
  arch?: string;
  /** Output directory for the archive */
  outDir?: string;
  /** Code signing identity for .node native modules on macOS */
  codesignIdentity?: string;
  /** Path to entitlements.plist */
  entitlementsPath?: string;
}

/**
 * Create a platform archive (.tar.gz) with all binaries and lib assets.
 */
export function createArchive(opts: PackageOptions): string {
  const platform = opts.platform ?? os.platform();
  const arch = opts.arch ?? os.arch();
  const outDir = opts.outDir ?? DIST_SEA;
  const version = getVersion();

  // Create a staging directory
  const stagingDir = path.join(outDir, 'staging');
  fs.mkdirSync(stagingDir, { recursive: true });

  // Copy binaries
  for (const bin of opts.binaries) {
    if (fs.existsSync(bin.path)) {
      fs.copyFileSync(bin.path, path.join(stagingDir, bin.name));
      fs.chmodSync(path.join(stagingDir, bin.name), 0o755);
      console.log(`[STAGE] ${bin.name}`);
    } else {
      console.log(`[WARN] Binary not found: ${bin.path}`);
    }
  }

  // Copy native modules
  const nativeDir = path.join(stagingDir, 'native');
  fs.mkdirSync(nativeDir, { recursive: true });

  const nativeSearchPaths = [
    path.join(ROOT, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'),
    path.join(ROOT, 'node_modules/better-sqlite3/prebuilds', `${platform}-${arch}`, 'better_sqlite3.node'),
  ];

  let nativeFound = false;
  for (const searchPath of nativeSearchPaths) {
    if (fs.existsSync(searchPath)) {
      const destPath = path.join(nativeDir, 'better_sqlite3.node');
      fs.copyFileSync(searchPath, destPath);
      nativeFound = true;
      console.log(`[NATIVE] Copied better_sqlite3.node from ${searchPath}`);

      // Sign .node native modules when a real signing identity is provided
      if (platform === 'darwin' && opts.codesignIdentity) {
        codesignBinary(destPath, opts.codesignIdentity, opts.entitlementsPath);
      }
      break;
    }
  }
  if (!nativeFound) {
    console.log('[WARN] better_sqlite3.node not found');
  }

  // Copy worker and interceptor from daemon build output (if exists)
  const daemonDistDir = path.join(outDir, 'apps', 'daemon-bin');
  for (const subDir of ['workers', 'interceptor', 'client']) {
    const srcDir = path.join(daemonDistDir, subDir);
    if (fs.existsSync(srcDir)) {
      const destDir = path.join(stagingDir, subDir);
      fs.mkdirSync(destDir, { recursive: true });
      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }
      console.log(`[STAGE] ${subDir}/`);
    }
  }

  // Copy UI assets if they exist
  const uiAssetsDir = path.join(ROOT, 'dist', 'apps', 'shield-ui');
  if (fs.existsSync(uiAssetsDir)) {
    const destUiDir = path.join(stagingDir, 'ui-assets');
    fs.mkdirSync(destUiDir, { recursive: true });
    execSync(`cp -R "${uiAssetsDir}/." "${destUiDir}/"`, { stdio: 'pipe' });
    console.log('[STAGE] ui-assets/');
  }

  // Copy macOS menu bar app if it exists (darwin only)
  if (platform === 'darwin') {
    const macAppDir = path.join(ROOT, 'dist', 'apps', 'shield-macos', 'Release', 'AgenShield.app');
    if (fs.existsSync(macAppDir)) {
      const destAppDir = path.join(stagingDir, 'AgenShield.app');
      execSync(`cp -R "${macAppDir}" "${destAppDir}"`, { stdio: 'pipe' });
      console.log('[STAGE] AgenShield.app');

      // Sign the app binary if signing identity is available
      if (opts.codesignIdentity) {
        const appBinary = path.join(destAppDir, 'Contents', 'MacOS', 'AgenShield');
        if (fs.existsSync(appBinary)) {
          codesignBinary(appBinary, opts.codesignIdentity, opts.entitlementsPath);
        }
        // Also sign the whole .app bundle
        codesignBinary(destAppDir, opts.codesignIdentity, opts.entitlementsPath);
      }
    } else {
      console.log('[INFO] AgenShield.app not found — skipping menu bar app staging');
    }
  }

  // Create archive
  const archiveName = `agenshield-${version}-${platform}-${arch}.tar.gz`;
  const archivePath = path.join(outDir, archiveName);

  run(
    `tar -czf "${archivePath}" -C "${stagingDir}" .`,
    `Package archive: ${archiveName}`,
  );

  // Generate checksum
  const checksumPath = path.join(outDir, 'checksums.sha256');
  const checksum = execSync(`shasum -a 256 "${archivePath}"`, { encoding: 'utf-8' }).trim();
  fs.appendFileSync(checksumPath, checksum + '\n');
  console.log(`[CHECKSUM] ${checksum}`);

  // Clean up staging
  fs.rmSync(stagingDir, { recursive: true, force: true });

  console.log(`\n[DONE] Archive: ${archivePath}`);
  return archivePath;
}

// ---------------------------------------------------------------------------
// Compress UI assets
// ---------------------------------------------------------------------------

/**
 * Compress UI assets into a tar.gz for SEA embedding.
 */
export function compressUIAssets(outDir: string): string {
  const assetsDir = path.join(outDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const uiDistPath = path.join(ROOT, 'dist', 'apps', 'shield-ui');
  const tarPath = path.join(assetsDir, 'ui-assets.tar.gz');

  if (!fs.existsSync(uiDistPath)) {
    console.log('[WARN] UI build output not found, creating empty placeholder');
    fs.writeFileSync(tarPath, Buffer.alloc(0));
    return tarPath;
  }

  run(
    `tar -czf "${tarPath}" -C "${uiDistPath}" .`,
    'Compress UI assets',
  );

  return tarPath;
}
