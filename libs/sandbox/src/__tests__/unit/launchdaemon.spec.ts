import { generateBrokerPlist, generateBrokerLauncherScript } from '../../enforcement/launchdaemon';
import { generateBrokerPlistLegacy } from '../../legacy';
import type { UserConfig } from '@agenshield/ipc';

const mockUserConfig: UserConfig = {
  agentUser: {
    username: 'ash_test_agent',
    uid: 5200,
    gid: 5100,
    home: '/Users/ash_test_agent',
    shell: '/Users/ash_test_agent/.agenshield/bin/guarded-shell',
    realname: 'AgenShield Agent (test)',
    groups: ['ash_test'],
  },
  brokerUser: {
    username: 'ash_test_broker',
    uid: 5201,
    gid: 5100,
    home: '/var/empty',
    shell: '/bin/bash',
    realname: 'AgenShield Broker (test)',
    groups: ['ash_test'],
  },
  groups: {
    socket: {
      name: 'ash_test',
      gid: 5100,
      description: 'AgenShield socket access (test)',
    },
  },
  prefix: '',
  baseName: 'test',
  baseUid: 5200,
  baseGid: 5100,
};

describe('generateBrokerPlist', () => {
  it('generates valid XML plist', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain('<!DOCTYPE plist');
    expect(plist).toContain('<plist version="1.0">');
    expect(plist).toContain('</plist>');
  });

  it('contains the correct label', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('<string>com.agenshield.broker</string>');
  });

  it('uses custom baseName in label when provided', () => {
    const plist = generateBrokerPlist(mockUserConfig, {
      baseName: 'openclaw',
      hostHome: '/Users/testuser',
    });

    expect(plist).toContain(
      '<string>com.agenshield.broker.openclaw</string>',
    );
  });

  it('contains broker username and socket group', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('<string>ash_test_broker</string>');
    expect(plist).toContain('<string>ash_test</string>');
  });

  it('has RunAtLoad and KeepAlive set to true', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  });

  it('contains environment variables', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('AGENSHIELD_CONFIG');
    expect(plist).toContain('AGENSHIELD_SOCKET');
    expect(plist).toContain('AGENSHIELD_AGENT_HOME');
    expect(plist).toContain('NODE_ENV');
    expect(plist).toContain('production');
  });

  it('references agent home in socket path', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain(
      '/Users/ash_test_agent/.agenshield/run/agenshield.sock',
    );
  });

  it('contains log paths under agent home', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('/Users/ash_test_agent/.agenshield/logs/broker.log');
    expect(plist).toContain(
      '/Users/ash_test_agent/.agenshield/logs/broker.error.log',
    );
  });

  it('includes the associated bundle identifier when includeAssociatedBundle is true', () => {
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      includeAssociatedBundle: true,
    });

    expect(plist).toContain('AssociatedBundleIdentifiers');
    expect(plist).toContain('com.frontegg.AgenShieldES');
  });

  it('omits the associated bundle identifier when includeAssociatedBundle is false', () => {
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      includeAssociatedBundle: false,
    });

    expect(plist).not.toContain('AssociatedBundleIdentifiers');
    expect(plist).not.toContain('com.frontegg.AgenShieldES');
  });

  it('omits the associated bundle identifier by default', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).not.toContain('AssociatedBundleIdentifiers');
    expect(plist).not.toContain('com.frontegg.AgenShieldES');
  });

  it('uses per-target node-bin and shared broker binary', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('/Users/ash_test_agent/bin/node-bin');
    expect(plist).toContain('/Users/testuser/.agenshield/libexec/agenshield-broker');
  });

  it('omits node-bin from ProgramArguments when isSEABinary is true', () => {
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      isSEABinary: true,
    });

    // Should contain the broker binary path
    expect(plist).toContain('/Users/testuser/.agenshield/libexec/agenshield-broker');
    // Should NOT contain node-bin in ProgramArguments
    expect(plist).not.toContain('node-bin');
  });

  it('includes node-bin in ProgramArguments when isSEABinary is false', () => {
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      isSEABinary: false,
    });

    expect(plist).toContain('/Users/ash_test_agent/bin/node-bin');
    expect(plist).toContain('/Users/testuser/.agenshield/libexec/agenshield-broker');
  });

  it('uses /bin/bash + launcher script in ProgramArguments when launcherScriptPath is set', () => {
    const launcherPath = '/Users/ash_test_agent/.agenshield/bin/broker-launcher.sh';
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      launcherScriptPath: launcherPath,
    });

    expect(plist).toContain('<string>/bin/bash</string>');
    expect(plist).toContain(`<string>${launcherPath}</string>`);
    // Should NOT contain the broker binary or node-bin in ProgramArguments
    expect(plist).not.toMatch(/<array>[\s\S]*node-bin[\s\S]*<\/array>/);
  });

  it('launcherScriptPath takes precedence over isSEABinary', () => {
    const launcherPath = '/Users/ash_test_agent/.agenshield/bin/broker-launcher.sh';
    const plist = generateBrokerPlist(mockUserConfig, {
      hostHome: '/Users/testuser',
      isSEABinary: true,
      launcherScriptPath: launcherPath,
    });

    expect(plist).toContain('<string>/bin/bash</string>');
    expect(plist).toContain(`<string>${launcherPath}</string>`);
    // The SEA binary path should still appear in EnvironmentVariables but not in ProgramArguments
    const programArgs = plist.match(/<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/);
    expect(programArgs).toBeTruthy();
    expect(programArgs![1]).toContain('/bin/bash');
    expect(programArgs![1]).toContain(launcherPath);
    expect(programArgs![1]).not.toContain('agenshield-broker');
  });
});

describe('generateBrokerLauncherScript', () => {
  const defaultOpts = {
    brokerBinaryPath: '/Users/testuser/.agenshield/libexec/agenshield-broker',
    configPath: '/Users/ash_test_agent/.agenshield/config/shield.json',
    socketPath: '/Users/ash_test_agent/.agenshield/run/agenshield.sock',
    agentHome: '/Users/ash_test_agent',
    hostHome: '/Users/testuser',
    logDir: '/Users/ash_test_agent/.agenshield/logs',
    daemonUrl: 'http://127.0.0.1:5200',
    profileId: 'ash_test_agent',
  };

  it('starts with bash shebang and set -euo pipefail', () => {
    const script = generateBrokerLauncherScript(defaultOpts);

    expect(script).toMatch(/^#!\/bin\/bash\n/);
    expect(script).toContain('set -euo pipefail');
  });

  it('exports all required environment variables', () => {
    const script = generateBrokerLauncherScript(defaultOpts);

    expect(script).toContain(`export AGENSHIELD_CONFIG="${defaultOpts.configPath}"`);
    expect(script).toContain(`export AGENSHIELD_SOCKET="${defaultOpts.socketPath}"`);
    expect(script).toContain(`export AGENSHIELD_AGENT_HOME="${defaultOpts.agentHome}"`);
    expect(script).toContain(`export AGENSHIELD_HOST_HOME="${defaultOpts.hostHome}"`);
    expect(script).toContain(`export AGENSHIELD_DAEMON_URL="${defaultOpts.daemonUrl}"`);
    expect(script).toContain(`export AGENSHIELD_PROFILE_ID="${defaultOpts.profileId}"`);
    expect(script).toContain('export NODE_ENV="production"');
  });

  it('exec-replaces with the broker binary path', () => {
    const script = generateBrokerLauncherScript(defaultOpts);

    expect(script).toContain(`exec "${defaultOpts.brokerBinaryPath}"`);
  });

  it('includes BETTER_SQLITE3_BINDING when nativeModulePath is set', () => {
    const script = generateBrokerLauncherScript({
      ...defaultOpts,
      nativeModulePath: '/Users/testuser/.agenshield/lib/v1.0.0/native/better_sqlite3.node',
    });

    expect(script).toContain('export BETTER_SQLITE3_BINDING="/Users/testuser/.agenshield/lib/v1.0.0/native/better_sqlite3.node"');
  });

  it('omits BETTER_SQLITE3_BINDING when nativeModulePath is not set', () => {
    const script = generateBrokerLauncherScript(defaultOpts);

    expect(script).not.toContain('BETTER_SQLITE3_BINDING');
  });
});

describe('generateBrokerPlistLegacy', () => {
  it('generates valid XML plist', () => {
    const plist = generateBrokerPlistLegacy();

    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain('</plist>');
  });

  it('uses default paths when no options provided', () => {
    const home = process.env['AGENSHIELD_USER_HOME'] || process.env['HOME'] || '';
    const plist = generateBrokerPlistLegacy();

    expect(plist).toContain('/opt/agenshield/bin/agenshield-broker');
    expect(plist).toContain('/opt/agenshield/config/shield.json');
    expect(plist).toContain(`${home}/.agenshield/run/agenshield.sock`);
  });

  it('uses custom options when provided', () => {
    const plist = generateBrokerPlistLegacy({
      brokerBinary: '/custom/broker',
      configPath: '/custom/config.json',
      socketPath: '/custom/socket.sock',
    });

    expect(plist).toContain('/custom/broker');
    expect(plist).toContain('/custom/config.json');
    expect(plist).toContain('/custom/socket.sock');
  });
});
