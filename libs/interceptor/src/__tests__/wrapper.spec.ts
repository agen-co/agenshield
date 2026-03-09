import { generatePythonWrapper } from '../python/wrapper';

describe('generatePythonWrapper', () => {
  it('generates sandbox-exec wrapper when useSandbox is true', () => {
    const result = generatePythonWrapper({
      pythonPath: '/usr/bin/python3',
      sitecustomizePath: '/site-packages',
      useSandbox: true,
      sandboxProfilePath: '/home/.agenshield/seatbelt/python.sb',
    });

    expect(result).toContain('#!/bin/bash');
    expect(result).toContain('AgenShield Python Wrapper');
    expect(result).toContain('set -e');
    expect(result).toContain('PYTHONDONTWRITEBYTECODE=1');
    expect(result).toContain('exec /usr/bin/sandbox-exec -f "/home/.agenshield/seatbelt/python.sb"');
    expect(result).toContain('"/usr/bin/python3" "$@"');
    expect(result).not.toContain('PYTHONPATH');
  });

  it('generates PYTHONPATH wrapper when useSandbox is false', () => {
    const result = generatePythonWrapper({
      pythonPath: '/usr/bin/python3',
      sitecustomizePath: '/site-packages',
      useSandbox: false,
    });

    expect(result).toContain('#!/bin/bash');
    expect(result).toContain('PYTHONPATH="/site-packages:${PYTHONPATH:-}"');
    expect(result).toContain('exec "/usr/bin/python3" "$@"');
    expect(result).not.toContain('sandbox-exec');
  });

  it('includes custom environment variables', () => {
    const result = generatePythonWrapper({
      pythonPath: '/usr/bin/python3',
      sitecustomizePath: '/site-packages',
      useSandbox: false,
      environmentVariables: {
        FOO: 'bar',
        BAZ: 'qux',
      },
    });

    expect(result).toContain('export FOO="bar"');
    expect(result).toContain('export BAZ="qux"');
  });

  it('handles empty environment variables', () => {
    const result = generatePythonWrapper({
      pythonPath: '/usr/bin/python3',
      sitecustomizePath: '/sp',
      useSandbox: false,
      environmentVariables: {},
    });

    expect(result).toContain('#!/bin/bash');
    expect(result).toContain('exec "/usr/bin/python3" "$@"');
  });

  it('handles undefined environment variables', () => {
    const result = generatePythonWrapper({
      pythonPath: '/usr/bin/python3',
      sitecustomizePath: '/sp',
      useSandbox: false,
    });

    expect(result).toContain('#!/bin/bash');
  });
});
