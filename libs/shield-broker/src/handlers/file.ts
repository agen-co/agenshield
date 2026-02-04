/**
 * File Operation Handlers
 *
 * Handles file read, write, and list operations.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  HandlerContext,
  HandlerResult,
  FileReadParams,
  FileReadResult,
  FileWriteParams,
  FileWriteResult,
  FileListParams,
  FileListResult,
} from '../types.js';
import type { HandlerDependencies } from './types.js';

/**
 * Handle file read operation
 */
export async function handleFileRead(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<FileReadResult>> {
  const startTime = Date.now();

  try {
    const { path: filePath, encoding = 'utf-8' } = params as unknown as FileReadParams;

    if (!filePath) {
      return {
        success: false,
        error: { code: 1003, message: 'Path is required' },
      };
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(filePath);

    // Check if file exists
    try {
      await fs.access(absolutePath, fs.constants.R_OK);
    } catch {
      return {
        success: false,
        error: { code: 1005, message: `File not found or not readable: ${absolutePath}` },
      };
    }

    // Get file stats
    const stats = await fs.stat(absolutePath);

    if (!stats.isFile()) {
      return {
        success: false,
        error: { code: 1005, message: 'Path is not a file' },
      };
    }

    // Read file content
    const content = await fs.readFile(absolutePath, { encoding: encoding as BufferEncoding });

    return {
      success: true,
      data: {
        content,
        size: stats.size,
        mtime: stats.mtime.toISOString(),
      },
      audit: {
        duration: Date.now() - startTime,
        bytesTransferred: stats.size,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 1005, message: `File read error: ${(error as Error).message}` },
    };
  }
}

/**
 * Handle file write operation
 */
export async function handleFileWrite(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<FileWriteResult>> {
  const startTime = Date.now();

  try {
    const {
      path: filePath,
      content,
      encoding = 'utf-8',
      mode,
    } = params as unknown as FileWriteParams;

    if (!filePath) {
      return {
        success: false,
        error: { code: 1003, message: 'Path is required' },
      };
    }

    if (content === undefined) {
      return {
        success: false,
        error: { code: 1003, message: 'Content is required' },
      };
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(filePath);

    // Ensure parent directory exists
    const parentDir = path.dirname(absolutePath);
    await fs.mkdir(parentDir, { recursive: true });

    // Write file
    const buffer = Buffer.from(content, encoding as BufferEncoding);
    await fs.writeFile(absolutePath, buffer, { mode });

    return {
      success: true,
      data: {
        bytesWritten: buffer.length,
        path: absolutePath,
      },
      audit: {
        duration: Date.now() - startTime,
        bytesTransferred: buffer.length,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 1005, message: `File write error: ${(error as Error).message}` },
    };
  }
}

/**
 * Handle file list operation
 */
export async function handleFileList(
  params: Record<string, unknown>,
  context: HandlerContext,
  deps: HandlerDependencies
): Promise<HandlerResult<FileListResult>> {
  const startTime = Date.now();

  try {
    const { path: dirPath, recursive = false, pattern } = params as unknown as FileListParams;

    if (!dirPath) {
      return {
        success: false,
        error: { code: 1003, message: 'Path is required' },
      };
    }

    // Resolve to absolute path
    const absolutePath = path.resolve(dirPath);

    // Check if directory exists
    try {
      await fs.access(absolutePath, fs.constants.R_OK);
    } catch {
      return {
        success: false,
        error: { code: 1005, message: `Directory not found or not readable: ${absolutePath}` },
      };
    }

    const stats = await fs.stat(absolutePath);
    if (!stats.isDirectory()) {
      return {
        success: false,
        error: { code: 1005, message: 'Path is not a directory' },
      };
    }

    // List directory contents
    const entries = await listDirectory(absolutePath, recursive, pattern);

    return {
      success: true,
      data: { entries },
      audit: {
        duration: Date.now() - startTime,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: { code: 1005, message: `File list error: ${(error as Error).message}` },
    };
  }
}

/**
 * List directory contents
 */
async function listDirectory(
  dirPath: string,
  recursive: boolean,
  pattern?: string
): Promise<FileListResult['entries']> {
  const entries: FileListResult['entries'] = [];
  const items = await fs.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    const itemPath = path.join(dirPath, item.name);

    // Check pattern if specified
    if (pattern && !matchPattern(item.name, pattern)) {
      continue;
    }

    try {
      const stats = await fs.stat(itemPath);

      entries.push({
        name: item.name,
        path: itemPath,
        type: item.isDirectory() ? 'directory' : item.isSymbolicLink() ? 'symlink' : 'file',
        size: stats.size,
        mtime: stats.mtime.toISOString(),
      });

      // Recurse into directories
      if (recursive && item.isDirectory()) {
        const subEntries = await listDirectory(itemPath, recursive, pattern);
        entries.push(...subEntries);
      }
    } catch {
      // Skip items we can't stat
    }
  }

  return entries;
}

/**
 * Simple glob pattern matching
 */
function matchPattern(name: string, pattern: string): boolean {
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');

  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(name);
}
