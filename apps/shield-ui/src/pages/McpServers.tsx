/**
 * MCP Servers page — table list of registered MCP servers
 */

import { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  Skeleton,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { Plus, RefreshCw, ShieldOff, Shield } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { tokens } from '../styles/tokens';
import { PageHeader } from '../components/shared/PageHeader';
import {
  useMcpServers,
  useCreateMcpServer,
  useScanMcpServers,
} from '../api/hooks';
import type { CreateMcpServerRequest } from '../api/client';

const STATUS_COLORS: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  active: 'success',
  disabled: 'default',
  pending: 'warning',
  blocked: 'error',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual',
  cloud: 'Cloud',
  agenco: 'AgenCo',
  workspace: 'Workspace',
};

function AddMcpServerDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateMcpServerRequest) => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'sse' | 'streamable-http'>('stdio');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    if (!name.trim() || !slug.trim()) {
      setError('Name and slug are required');
      return;
    }

    const input: CreateMcpServerRequest = {
      name: name.trim(),
      slug: slug.trim(),
      transport,
    };

    if (transport === 'stdio') {
      input.command = command.trim() || null;
      input.args = args.trim() ? args.split(/\s+/) : [];
    } else {
      input.url = url.trim() || null;
    }

    onSubmit(input);
    handleClose();
  };

  const handleClose = () => {
    setName('');
    setSlug('');
    setTransport('stdio');
    setCommand('');
    setArgs('');
    setUrl('');
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add MCP Server</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && (
            <Typography color="error" variant="body2">{error}</Typography>
          )}
          <TextField
            label="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label="Slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
            fullWidth
            size="small"
            helperText="Unique identifier (lowercase, hyphens, underscores)"
          />
          <TextField
            label="Transport"
            select
            value={transport}
            onChange={(e) => setTransport(e.target.value as typeof transport)}
            fullWidth
            size="small"
          >
            <MenuItem value="stdio">stdio</MenuItem>
            <MenuItem value="sse">SSE</MenuItem>
            <MenuItem value="streamable-http">Streamable HTTP</MenuItem>
          </TextField>

          {transport === 'stdio' ? (
            <>
              <TextField
                label="Command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                fullWidth
                size="small"
                placeholder="npx"
              />
              <TextField
                label="Arguments"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                fullWidth
                size="small"
                placeholder="-y @example/mcp-server"
                helperText="Space-separated arguments"
              />
            </>
          ) : (
            <TextField
              label="URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              fullWidth
              size="small"
              placeholder="https://example.com/mcp"
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit}>Add</Button>
      </DialogActions>
    </Dialog>
  );
}

export function McpServers() {
  const { data, isLoading } = useMcpServers();
  const createMutation = useCreateMcpServer();
  const scanMutation = useScanMcpServers();
  const navigate = useNavigate();

  const [addOpen, setAddOpen] = useState(false);

  const servers = data?.data ?? [];

  const handleCreate = (input: CreateMcpServerRequest) => {
    createMutation.mutate(input);
  };

  const handleRowClick = (id: string) => {
    navigate(`/mcps/${id}`);
  };

  return (
    <Box sx={{ maxWidth: tokens.page.maxWidth, mx: 'auto', width: '100%' }}>
      <PageHeader
        title="MCP Servers"
        description="Manage Model Context Protocol server connections"
        action={
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<RefreshCw size={14} />}
              onClick={() => scanMutation.mutate()}
              disabled={scanMutation.isPending}
            >
              Scan
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<Plus size={14} />}
              onClick={() => setAddOpen(true)}
            >
              Add Server
            </Button>
          </Box>
        }
      />

      {isLoading ? (
        <Box>
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} variant="rectangular" height={48} sx={{ mb: 0.5, borderRadius: 1 }} />
          ))}
        </Box>
      ) : servers.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <ShieldOff size={48} style={{ opacity: 0.3 }} />
          <Typography variant="h6" sx={{ mt: 2 }}>
            No MCP servers registered
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Add MCP servers to manage connections to external tools and services.
          </Typography>
          <Button
            variant="contained"
            startIcon={<Plus size={14} />}
            onClick={() => setAddOpen(true)}
            sx={{ mt: 2 }}
          >
            Add Server
          </Button>
        </Box>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Transport</TableCell>
                <TableCell>Source</TableCell>
                <TableCell>Managed</TableCell>
                <TableCell>Endpoint</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {servers.map((server) => (
                <TableRow
                  key={server.id}
                  hover
                  onClick={() => handleRowClick(server.id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {server.name}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={server.status}
                      size="small"
                      color={STATUS_COLORS[server.status] ?? 'default'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell>
                    <Chip label={server.transport} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {SOURCE_LABELS[server.source] ?? server.source}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {server.managed ? (
                      <Shield size={16} style={{ opacity: 0.6 }} />
                    ) : (
                      <Typography variant="body2" color="text.secondary">-</Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      sx={{
                        fontFamily: 'monospace',
                        fontSize: '0.75rem',
                        maxWidth: 280,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {server.transport === 'stdio'
                        ? server.command ?? '-'
                        : server.url ?? '-'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <AddMcpServerDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleCreate}
      />
    </Box>
  );
}
