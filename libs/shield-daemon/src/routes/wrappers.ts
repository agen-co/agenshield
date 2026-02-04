/**
 * Wrapper management routes
 *
 * Provides API endpoints for dynamic wrapper management.
 * Allows adding, removing, updating wrappers based on policy configuration.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  getAvailableWrappers,
  getWrapperDefinition,
  generateWrapperContent,
  installSpecificWrappers,
  uninstallWrapper,
  updateWrapper,
  verifyWrappers,
  addDynamicWrapper,
  removeDynamicWrapper,
  getDefaultWrapperConfig,
  wrapperUsesSeatbelt,
  wrapperUsesInterceptor,
} from '@agenshield/sandbox';
import type { WrapperConfig } from '@agenshield/sandbox';
import { emitEvent, type EventType } from '../events/emitter';

/**
 * Request body for adding a custom wrapper
 */
interface AddWrapperBody {
  name: string;
  content: string;
  useSudo?: boolean;
  owner?: string;
  group?: string;
}

/**
 * Request body for updating a wrapper
 */
interface UpdateWrapperBody {
  useSudo?: boolean;
  config?: Partial<WrapperConfig>;
}

/**
 * Request body for batch wrapper operations
 */
interface BatchWrapperBody {
  names: string[];
  targetDir?: string;
}

/**
 * Request body for policy-triggered wrapper sync
 */
interface PolicySyncBody {
  enabledWrappers: string[];
  disabledWrappers?: string[];
  targetDir?: string;
}

/**
 * Default wrapper target directory
 */
const DEFAULT_TARGET_DIR = '/Users/clawagent/bin';

/**
 * Register wrapper management routes
 */
export async function wrappersRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /wrappers - List all available wrappers
   */
  app.get('/wrappers', async (_request: FastifyRequest, reply: FastifyReply) => {
    const available = getAvailableWrappers();
    const wrappers = available.map((name) => {
      const def = getWrapperDefinition(name);
      return {
        name,
        description: def?.description || '',
        usesSeatbelt: wrapperUsesSeatbelt(name),
        usesInterceptor: wrapperUsesInterceptor(name),
      };
    });

    return reply.send({
      wrappers,
      count: wrappers.length,
    });
  });

  /**
   * GET /wrappers/:name - Get specific wrapper info
   */
  app.get<{ Params: { name: string } }>(
    '/wrappers/:name',
    async (request: FastifyRequest<{ Params: { name: string } }>, reply: FastifyReply) => {
      const { name } = request.params;
      const def = getWrapperDefinition(name);

      if (!def) {
        return reply.code(404).send({
          error: 'Wrapper not found',
          name,
        });
      }

      const content = generateWrapperContent(name);

      return reply.send({
        name,
        description: def.description,
        usesSeatbelt: wrapperUsesSeatbelt(name),
        usesInterceptor: wrapperUsesInterceptor(name),
        content,
      });
    }
  );

  /**
   * GET /wrappers/status - Get installation status
   */
  app.get<{ Querystring: { targetDir?: string } }>(
    '/wrappers/status',
    async (
      request: FastifyRequest<{ Querystring: { targetDir?: string } }>,
      reply: FastifyReply
    ) => {
      const targetDir = request.query.targetDir || DEFAULT_TARGET_DIR;
      const status = await verifyWrappers(targetDir);

      return reply.send({
        targetDir,
        valid: status.valid,
        installed: status.installed,
        missing: status.missing,
        installedCount: status.installed.length,
        missingCount: status.missing.length,
      });
    }
  );

  /**
   * POST /wrappers/install - Install specific wrappers
   */
  app.post<{ Body: BatchWrapperBody }>(
    '/wrappers/install',
    async (request: FastifyRequest<{ Body: BatchWrapperBody }>, reply: FastifyReply) => {
      const { names, targetDir = DEFAULT_TARGET_DIR } = request.body;

      if (!names || names.length === 0) {
        return reply.code(400).send({
          error: 'No wrapper names provided',
        });
      }

      const results = await installSpecificWrappers(names, targetDir);
      const success = results.every((r) => r.success);

      emitEvent('wrappers:installed', {
        names,
        targetDir,
        success,
        results: results.map((r) => ({ name: r.name, success: r.success, message: r.message })),
      });

      return reply.code(success ? 200 : 207).send({
        success,
        targetDir,
        results: results.map((r) => ({
          name: r.name,
          success: r.success,
          path: r.path,
          message: r.message,
        })),
      });
    }
  );

  /**
   * DELETE /wrappers/:name - Uninstall a specific wrapper
   */
  app.delete<{ Params: { name: string }; Querystring: { targetDir?: string } }>(
    '/wrappers/:name',
    async (
      request: FastifyRequest<{ Params: { name: string }; Querystring: { targetDir?: string } }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;
      const targetDir = request.query.targetDir || DEFAULT_TARGET_DIR;

      const result = await uninstallWrapper(name, targetDir);

      emitEvent('wrappers:uninstalled', {
        name,
        targetDir,
        success: result.success,
        message: result.message,
      });

      return reply.code(result.success ? 200 : 500).send({
        success: result.success,
        name,
        path: result.path,
        message: result.message,
      });
    }
  );

  /**
   * PUT /wrappers/:name - Update a specific wrapper
   */
  app.put<{ Params: { name: string }; Body: UpdateWrapperBody; Querystring: { targetDir?: string } }>(
    '/wrappers/:name',
    async (
      request: FastifyRequest<{
        Params: { name: string };
        Body: UpdateWrapperBody;
        Querystring: { targetDir?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;
      const { useSudo = false, config } = request.body;
      const targetDir = request.query.targetDir || DEFAULT_TARGET_DIR;

      // Merge custom config with defaults
      const wrapperConfig = config
        ? { ...getDefaultWrapperConfig(), ...config }
        : undefined;

      const result = await updateWrapper(name, targetDir, wrapperConfig, useSudo);

      emitEvent('wrappers:updated', {
        name,
        targetDir,
        success: result.success,
        message: result.message,
      });

      return reply.code(result.success ? 200 : 500).send({
        success: result.success,
        name,
        path: result.path,
        message: result.message,
      });
    }
  );

  /**
   * POST /wrappers/custom - Add a custom wrapper
   */
  app.post<{ Body: AddWrapperBody; Querystring: { targetDir?: string } }>(
    '/wrappers/custom',
    async (
      request: FastifyRequest<{ Body: AddWrapperBody; Querystring: { targetDir?: string } }>,
      reply: FastifyReply
    ) => {
      const { name, content, useSudo = false, owner, group } = request.body;
      const targetDir = request.query.targetDir || DEFAULT_TARGET_DIR;

      if (!name || !content) {
        return reply.code(400).send({
          error: 'Name and content are required',
        });
      }

      // Validate wrapper name (prevent path traversal)
      if (name.includes('/') || name.includes('..')) {
        return reply.code(400).send({
          error: 'Invalid wrapper name',
        });
      }

      const result = await addDynamicWrapper(name, content, targetDir, useSudo, owner, group);

      emitEvent('wrappers:custom_added', {
        name,
        targetDir,
        success: result.success,
        message: result.message,
      });

      return reply.code(result.success ? 201 : 500).send({
        success: result.success,
        name,
        path: result.path,
        message: result.message,
      });
    }
  );

  /**
   * DELETE /wrappers/custom/:name - Remove a custom wrapper
   */
  app.delete<{ Params: { name: string }; Querystring: { targetDir?: string; useSudo?: string } }>(
    '/wrappers/custom/:name',
    async (
      request: FastifyRequest<{
        Params: { name: string };
        Querystring: { targetDir?: string; useSudo?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { name } = request.params;
      const targetDir = request.query.targetDir || DEFAULT_TARGET_DIR;
      const useSudo = request.query.useSudo === 'true';

      const result = await removeDynamicWrapper(name, targetDir, useSudo);

      emitEvent('wrappers:custom_removed', {
        name,
        targetDir,
        success: result.success,
        message: result.message,
      });

      return reply.code(result.success ? 200 : 500).send({
        success: result.success,
        name,
        path: result.path,
        message: result.message,
      });
    }
  );

  /**
   * POST /wrappers/sync - Sync wrappers based on policy configuration
   *
   * This endpoint is called when policy configuration changes.
   * It ensures the correct wrappers are installed/removed based on the policy.
   */
  app.post<{ Body: PolicySyncBody }>(
    '/wrappers/sync',
    async (request: FastifyRequest<{ Body: PolicySyncBody }>, reply: FastifyReply) => {
      const {
        enabledWrappers,
        disabledWrappers = [],
        targetDir = DEFAULT_TARGET_DIR,
      } = request.body;

      const results: Array<{ name: string; action: string; success: boolean; message: string }> = [];

      // Get current installation status
      const status = await verifyWrappers(targetDir);

      // Install enabled wrappers that are missing
      const toInstall = enabledWrappers.filter((name) => !status.installed.includes(name));
      if (toInstall.length > 0) {
        const installResults = await installSpecificWrappers(toInstall, targetDir);
        for (const r of installResults) {
          results.push({
            name: r.name,
            action: 'install',
            success: r.success,
            message: r.message,
          });
        }
      }

      // Remove disabled wrappers that are installed
      const toRemove = disabledWrappers.filter((name) => status.installed.includes(name));
      for (const name of toRemove) {
        const result = await uninstallWrapper(name, targetDir);
        results.push({
          name,
          action: 'uninstall',
          success: result.success,
          message: result.message,
        });
      }

      const allSuccess = results.every((r) => r.success);

      emitEvent('wrappers:synced', {
        targetDir,
        enabled: enabledWrappers,
        disabled: disabledWrappers,
        installed: toInstall,
        removed: toRemove,
        success: allSuccess,
      });

      return reply.code(allSuccess ? 200 : 207).send({
        success: allSuccess,
        targetDir,
        results,
        summary: {
          installed: toInstall.length,
          removed: toRemove.length,
          unchanged: enabledWrappers.length - toInstall.length,
        },
      });
    }
  );

  /**
   * POST /wrappers/regenerate - Regenerate all installed wrappers
   *
   * Useful when wrapper configuration changes (e.g., socket path, ports).
   */
  app.post<{ Body: { targetDir?: string; config?: Partial<WrapperConfig> } }>(
    '/wrappers/regenerate',
    async (
      request: FastifyRequest<{ Body: { targetDir?: string; config?: Partial<WrapperConfig> } }>,
      reply: FastifyReply
    ) => {
      const { targetDir = DEFAULT_TARGET_DIR, config } = request.body;

      // Get currently installed wrappers
      const status = await verifyWrappers(targetDir);

      if (status.installed.length === 0) {
        return reply.send({
          success: true,
          message: 'No wrappers installed to regenerate',
          regenerated: [],
        });
      }

      const wrapperConfig = config
        ? { ...getDefaultWrapperConfig(), ...config }
        : undefined;

      const results: Array<{ name: string; success: boolean; message: string }> = [];

      for (const name of status.installed) {
        const result = await updateWrapper(name, targetDir, wrapperConfig, false);
        results.push({
          name,
          success: result.success,
          message: result.message,
        });
      }

      const allSuccess = results.every((r) => r.success);

      emitEvent('wrappers:regenerated', {
        targetDir,
        count: results.length,
        success: allSuccess,
      });

      return reply.code(allSuccess ? 200 : 207).send({
        success: allSuccess,
        regenerated: results.filter((r) => r.success).map((r) => r.name),
        failed: results.filter((r) => !r.success).map((r) => r.name),
        results,
      });
    }
  );
}
