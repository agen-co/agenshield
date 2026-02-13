import { getRegisteredEventTypes } from '../event-registry';

// Import all domain modules to trigger augmentation + registration
import '../core.events';
import '../security.events';
import '../api.events';
import '../wrapper.events';
import '../skill.events';
import '../exec.events';
import '../agenco.events';
import '../process.events';

import { CORE_EVENT_TYPES } from '../core.events';
import { SECURITY_EVENT_TYPES } from '../security.events';
import { API_EVENT_TYPES } from '../api.events';
import { WRAPPER_EVENT_TYPES } from '../wrapper.events';
import { SKILL_EVENT_TYPES } from '../skill.events';
import { EXEC_EVENT_TYPES } from '../exec.events';
import { AGENCO_EVENT_TYPES } from '../agenco.events';
import { PROCESS_EVENT_TYPES } from '../process.events';

const ALL_DOMAIN_ARRAYS = [
  CORE_EVENT_TYPES,
  SECURITY_EVENT_TYPES,
  API_EVENT_TYPES,
  WRAPPER_EVENT_TYPES,
  SKILL_EVENT_TYPES,
  EXEC_EVENT_TYPES,
  AGENCO_EVENT_TYPES,
  PROCESS_EVENT_TYPES,
];

describe('EventRegistry', () => {
  it('getRegisteredEventTypes() contains all domain event types', () => {
    const registered = getRegisteredEventTypes();
    const allExpected = ALL_DOMAIN_ARRAYS.flat();

    for (const type of allExpected) {
      expect(registered).toContain(type);
    }
  });

  it('all registered types total matches sum of domain arrays', () => {
    const registered = getRegisteredEventTypes();
    const allExpected = ALL_DOMAIN_ARRAYS.flat();

    expect(registered.length).toBe(allExpected.length);
  });

  it('has no duplicate event types', () => {
    const registered = getRegisteredEventTypes();
    const unique = new Set(registered);
    expect(unique.size).toBe(registered.length);
  });

  it('all event types except "heartbeat" contain ":"', () => {
    const registered = getRegisteredEventTypes();
    for (const type of registered) {
      if (type === 'heartbeat') continue;
      expect(type).toContain(':');
    }
  });

  it('domain arrays are non-empty', () => {
    for (const arr of ALL_DOMAIN_ARRAYS) {
      expect(arr.length).toBeGreaterThan(0);
    }
  });
});
