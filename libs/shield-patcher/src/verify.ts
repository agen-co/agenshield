/**
 * Python Patcher Verification
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { VerificationResult } from './types.js';

const execAsync = promisify(exec);

export class PythonVerifier {
  private pythonPath: string;
  private brokerHost: string;
  private brokerPort: number;

  constructor(options: {
    pythonPath: string;
    brokerHost?: string;
    brokerPort?: number;
  }) {
    this.pythonPath = options.pythonPath;
    this.brokerHost = options.brokerHost || 'localhost';
    this.brokerPort = options.brokerPort || 5200;
  }

  /**
   * Verify the Python patcher installation
   */
  async verify(): Promise<VerificationResult> {
    const details: string[] = [];
    let success = true;

    // Get Python version
    let pythonVersion = 'unknown';
    try {
      const { stdout } = await execAsync(`${this.pythonPath} --version`);
      pythonVersion = stdout.trim();
      details.push(`Python version: ${pythonVersion}`);
    } catch (error) {
      details.push(`Failed to get Python version: ${(error as Error).message}`);
      success = false;
    }

    // Check sitecustomize
    let sitecustomizeInstalled = false;
    try {
      const { stdout } = await execAsync(
        `${this.pythonPath} -c "import sitecustomize; print('AgenShield' in dir(sitecustomize) or hasattr(sitecustomize, '_agenshield_patched'))"`
      );
      sitecustomizeInstalled = stdout.trim() === 'True';
      details.push(
        sitecustomizeInstalled
          ? 'sitecustomize.py: AgenShield patch found'
          : 'sitecustomize.py: AgenShield patch NOT found'
      );
    } catch {
      details.push('sitecustomize.py: Not installed or error loading');
    }

    // Check network blocking
    let networkBlocked = false;
    try {
      const { stderr } = await execAsync(
        `${this.pythonPath} -c "import socket; socket.create_connection(('example.com', 80), timeout=5)" 2>&1`,
        { timeout: 10000 }
      );
      // If we get here without error, network is NOT blocked
      details.push('Network blocking: DISABLED (direct connections allowed)');
    } catch (error) {
      const message = (error as Error).message;
      if (
        message.includes('AgenShield') ||
        message.includes('Connection refused') ||
        message.includes('blocked')
      ) {
        networkBlocked = true;
        details.push('Network blocking: ENABLED');
      } else {
        details.push(`Network blocking: Unknown (${message})`);
      }
    }

    // Check broker accessibility
    let brokerAccessible = false;
    try {
      const script = `
import urllib.request
import json

req = urllib.request.Request(
    'http://${this.brokerHost}:${this.brokerPort}/health',
    method='GET'
)
with urllib.request.urlopen(req, timeout=5) as response:
    data = json.loads(response.read())
    print('ok' if data.get('status') == 'ok' else 'error')
`;
      const { stdout } = await execAsync(`${this.pythonPath} -c "${script}"`, {
        timeout: 10000,
      });
      brokerAccessible = stdout.trim() === 'ok';
      details.push(
        brokerAccessible
          ? 'Broker: Accessible'
          : 'Broker: Not accessible (check if running)'
      );
    } catch {
      details.push('Broker: Not accessible');
    }

    // Determine overall success
    success = sitecustomizeInstalled && networkBlocked && brokerAccessible;

    return {
      success,
      pythonVersion,
      sitecustomizeInstalled,
      networkBlocked,
      brokerAccessible,
      details,
    };
  }
}

/**
 * Quick verification function
 */
export async function verifyPython(pythonPath: string): Promise<VerificationResult> {
  const verifier = new PythonVerifier({ pythonPath });
  return verifier.verify();
}
