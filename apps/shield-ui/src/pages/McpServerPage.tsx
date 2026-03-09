/**
 * MCP Server detail page — server metadata + capability probing (tools, resources, prompts)
 *
 * Supports two modes:
 * - **Standalone**: rendered at `/mcps/:id` via react-router
 * - **Embedded**: rendered inside the Canvas PageOverlay via `serverId` + `embedded` props
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
  Skeleton,
  Typography,
} from '@mui/material';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Power,
  PowerOff,
  RefreshCw,
  Shield,
  Trash2,
  Wrench,
  FileText,
  MessageSquare,
} from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { tokens } from '../styles/tokens';
import { ConfirmDialog } from '../components/shared/ConfirmDialog';
import {
  useMcpServer,
  useMcpServerCapabilities,
  useRefreshMcpCapabilities,
  useEnableMcpServer,
  useDisableMcpServer,
  useApproveMcpServer,
  useDeleteMcpServer,
} from '../api/hooks';

const STATUS_COLORS: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  active: 'success',
  disabled: 'default',
  pending: 'warning',
  blocked: 'error',
};

interface McpServerPageProps {
  serverId?: string;
  embedded?: boolean;
}

export function McpServerPage({ serverId: propId, embedded }: McpServerPageProps) {
  const { id: routeId } = useParams<{ id: string }>();
  const id = propId ?? routeId ?? '';
  const navigate = useNavigate();

  const { data: serverData, isLoading: serverLoading } = useMcpServer(id);
  const server = serverData?.data;

  const canProbe = server?.status === 'active' || server?.status === 'pending';
  const { data: capData, isLoading: capLoading } = useMcpServerCapabilities(id, canProbe ?? false);
  const capabilities = capData?.data;

  const enableMutation = useEnableMcpServer();
  const disableMutation = useDisableMcpServer();
  const approveMutation = useApproveMcpServer();
  const deleteMutation = useDeleteMcpServer();
  const refreshMutation = useRefreshMcpCapabilities();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [resourcesOpen, setResourcesOpen] = useState(true);
  const [promptsOpen, setPromptsOpen] = useState(true);
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());

  const toggleSchema = (name: string) => {
    setExpandedSchemas((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleDelete = () => {
    deleteMutation.mutate(id, {
      onSuccess: () => navigate('/mcps'),
    });
    setDeleteOpen(false);
  };

  if (!id) return null;

  const content = (
    <>
      {!embedded && (
        <Button
          size="small"
          variant="text"
          color="secondary"
          startIcon={<ArrowLeft size={16} />}
          onClick={() => navigate('/mcps')}
          sx={{ mb: 2 }}
        >
          Back to MCP Servers
        </Button>
      )}

      {serverLoading ? (
        <Box>
          <Skeleton variant="text" width="40%" height={40} />
          <Skeleton variant="rectangular" height={200} sx={{ mt: 2, borderRadius: 1 }} />
        </Box>
      ) : !server ? (
        <Alert severity="info">MCP server not found</Alert>
      ) : (
        <Box>
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
            <Typography variant="h5" fontWeight={700}>{server.name}</Typography>
            <Chip
              label={server.status}
              size="small"
              color={STATUS_COLORS[server.status] ?? 'default'}
              variant="outlined"
            />
            {server.managed && (
              <Chip label="Managed" size="small" variant="filled" color="info" />
            )}
          </Box>

          {server.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {server.description}
            </Typography>
          )}

          {/* Action buttons */}
          <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
            {server.status === 'active' ? (
              <Button
                size="small"
                variant="outlined"
                startIcon={<PowerOff size={14} />}
                onClick={() => disableMutation.mutate(id)}
                disabled={disableMutation.isPending}
              >
                Disable
              </Button>
            ) : server.status === 'blocked' ? (
              <Button
                size="small"
                variant="outlined"
                color="success"
                startIcon={<Shield size={14} />}
                onClick={() => approveMutation.mutate(id)}
                disabled={approveMutation.isPending}
              >
                Approve
              </Button>
            ) : (
              <Button
                size="small"
                variant="outlined"
                color="success"
                startIcon={<Power size={14} />}
                onClick={() => enableMutation.mutate(id)}
                disabled={enableMutation.isPending}
              >
                Enable
              </Button>
            )}
            {canProbe && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<RefreshCw size={14} />}
                onClick={() => refreshMutation.mutate(id)}
                disabled={refreshMutation.isPending}
              >
                Refresh Capabilities
              </Button>
            )}
            {!server.managed && (
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<Trash2 size={14} />}
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </Button>
            )}
          </Box>

          {/* Info grid */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
              gap: 1.5,
              mb: 3,
              p: 2,
              border: 1,
              borderColor: 'divider',
              borderRadius: tokens.radius.md,
            }}
          >
            <InfoRow label="Transport" value={server.transport} />
            <InfoRow
              label={server.transport === 'stdio' ? 'Command' : 'URL'}
              value={
                server.transport === 'stdio'
                  ? [server.command, ...server.args].filter(Boolean).join(' ') || '-'
                  : server.url ?? '-'
              }
              mono
            />
            <InfoRow label="Auth Type" value={server.authType} />
            <InfoRow label="Source" value={server.source} />
            <InfoRow label="Profile Scope" value={server.profileId ?? 'Global'} />
            <InfoRow
              label="Supported Targets"
              value={server.supportedTargets.length > 0 ? server.supportedTargets.join(', ') : 'All'}
            />
            <InfoRow label="Created" value={new Date(server.createdAt).toLocaleString()} />
            <InfoRow label="Updated" value={new Date(server.updatedAt).toLocaleString()} />
          </Box>

          {/* Capabilities error */}
          {capabilities?.error && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              action={
                <Button
                  size="small"
                  onClick={() => refreshMutation.mutate(id)}
                  disabled={refreshMutation.isPending}
                >
                  Retry
                </Button>
              }
            >
              Probe failed: {capabilities.error}
            </Alert>
          )}

          {/* Capabilities loading */}
          {canProbe && capLoading && (
            <Box sx={{ mb: 3 }}>
              <Skeleton variant="rectangular" height={120} sx={{ borderRadius: 1 }} />
            </Box>
          )}

          {/* Tools section */}
          {capabilities && (
            <>
              <CapabilitySection
                icon={<Wrench size={16} />}
                title="Tools"
                count={capabilities.tools.length}
                open={toolsOpen}
                onToggle={() => setToolsOpen((v) => !v)}
              >
                {capabilities.tools.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    No tools exposed
                  </Typography>
                ) : (
                  capabilities.tools.map((tool) => (
                    <Box
                      key={tool.name}
                      sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Typography variant="body2" fontWeight={700} sx={{ fontFamily: 'monospace' }}>
                          {tool.name}
                        </Typography>
                        {tool.annotations?.destructiveHint && (
                          <Chip label="destructive" size="small" color="error" variant="outlined" />
                        )}
                        {tool.annotations?.readOnlyHint && (
                          <Chip label="read-only" size="small" color="info" variant="outlined" />
                        )}
                      </Box>
                      <Typography variant="body2" color="text.secondary">
                        {tool.description || 'No description'}
                      </Typography>
                      {Object.keys(tool.inputSchema).length > 0 && (
                        <Box sx={{ mt: 0.5 }}>
                          <Button
                            size="small"
                            variant="text"
                            onClick={() => toggleSchema(tool.name)}
                            startIcon={expandedSchemas.has(tool.name) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            sx={{ textTransform: 'none', p: 0, minWidth: 0 }}
                          >
                            Input schema
                          </Button>
                          <Collapse in={expandedSchemas.has(tool.name)}>
                            <Box
                              component="pre"
                              sx={{
                                mt: 0.5,
                                p: 1.5,
                                backgroundColor: 'action.hover',
                                borderRadius: 1,
                                fontSize: '0.75rem',
                                fontFamily: 'monospace',
                                overflow: 'auto',
                                maxHeight: 300,
                              }}
                            >
                              {JSON.stringify(tool.inputSchema, null, 2)}
                            </Box>
                          </Collapse>
                        </Box>
                      )}
                    </Box>
                  ))
                )}
              </CapabilitySection>

              {/* Resources section */}
              <CapabilitySection
                icon={<FileText size={16} />}
                title="Resources"
                count={capabilities.resources.length}
                open={resourcesOpen}
                onToggle={() => setResourcesOpen((v) => !v)}
              >
                {capabilities.resources.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    No resources exposed
                  </Typography>
                ) : (
                  capabilities.resources.map((resource) => (
                    <Box
                      key={resource.uri}
                      sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
                    >
                      <Typography variant="body2" fontWeight={600} sx={{ fontFamily: 'monospace' }}>
                        {resource.uri}
                      </Typography>
                      <Typography variant="body2">{resource.name}</Typography>
                      {resource.description && (
                        <Typography variant="body2" color="text.secondary">
                          {resource.description}
                        </Typography>
                      )}
                      {resource.mimeType && (
                        <Chip label={resource.mimeType} size="small" variant="outlined" sx={{ mt: 0.5 }} />
                      )}
                    </Box>
                  ))
                )}
              </CapabilitySection>

              {/* Prompts section */}
              <CapabilitySection
                icon={<MessageSquare size={16} />}
                title="Prompts"
                count={capabilities.prompts.length}
                open={promptsOpen}
                onToggle={() => setPromptsOpen((v) => !v)}
              >
                {capabilities.prompts.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    No prompts exposed
                  </Typography>
                ) : (
                  capabilities.prompts.map((prompt) => (
                    <Box
                      key={prompt.name}
                      sx={{ py: 1.5, borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
                    >
                      <Typography variant="body2" fontWeight={700}>
                        {prompt.name}
                      </Typography>
                      {prompt.description && (
                        <Typography variant="body2" color="text.secondary">
                          {prompt.description}
                        </Typography>
                      )}
                      {prompt.arguments && prompt.arguments.length > 0 && (
                        <Box sx={{ mt: 0.5 }}>
                          <Typography variant="caption" color="text.secondary" fontWeight={600}>
                            Arguments:
                          </Typography>
                          {prompt.arguments.map((arg) => (
                            <Box key={arg.name} sx={{ display: 'flex', gap: 1, alignItems: 'center', ml: 1 }}>
                              <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                {arg.name}
                              </Typography>
                              {arg.required && (
                                <Chip label="required" size="small" color="warning" variant="outlined" sx={{ height: 18, '& .MuiChip-label': { px: 0.5, fontSize: '0.65rem' } }} />
                              )}
                              {arg.description && (
                                <Typography variant="caption" color="text.secondary">
                                  {arg.description}
                                </Typography>
                              )}
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  ))
                )}
              </CapabilitySection>

              {capabilities.probedAt && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                  Last probed: {new Date(capabilities.probedAt).toLocaleString()}
                </Typography>
              )}
            </>
          )}
        </Box>
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete MCP Server"
        message="Are you sure you want to delete this MCP server? This will remove it from all target configs."
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );

  if (embedded) return content;

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto' }}>
      {content}
    </Box>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" fontWeight={600}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={mono ? { fontFamily: 'monospace', fontSize: '0.8rem', wordBreak: 'break-all' } : undefined}
      >
        {value}
      </Typography>
    </Box>
  );
}

function CapabilitySection({
  icon,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Button
        fullWidth
        onClick={onToggle}
        sx={{
          justifyContent: 'flex-start',
          textTransform: 'none',
          py: 1,
          px: 1.5,
          gap: 1,
          color: 'text.primary',
          borderBottom: 1,
          borderColor: 'divider',
          borderRadius: 0,
        }}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {icon}
        <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
        <Chip label={count} size="small" sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }} />
      </Button>
      <Collapse in={open}>
        <Box sx={{ px: 1.5 }}>
          {children}
        </Box>
      </Collapse>
    </Box>
  );
}
