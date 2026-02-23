import { generateBrokerPlist } from '../../enforcement/launchdaemon';
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

  it('includes the associated bundle identifier', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('com.frontegg.AgenShieldES');
  });

  it('includes custom node binary path from hostHome', () => {
    const plist = generateBrokerPlist(mockUserConfig, { hostHome: '/Users/testuser' });

    expect(plist).toContain('/Users/testuser/.agenshield/bin/node-bin');
    expect(plist).toContain('/Users/testuser/.agenshield/bin/agenshield-broker');
  });
});

describe('generateBrokerPlistLegacy', () => {
  it('generates valid XML plist', () => {
    const plist = generateBrokerPlistLegacy();

    expect(plist).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(plist).toContain('</plist>');
  });

  it('uses default paths when no options provided', () => {
    const plist = generateBrokerPlistLegacy();

    expect(plist).toContain('/opt/agenshield/bin/agenshield-broker');
    expect(plist).toContain('/opt/agenshield/config/shield.json');
    expect(plist).toContain('/var/run/agenshield/agenshield.sock');
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
