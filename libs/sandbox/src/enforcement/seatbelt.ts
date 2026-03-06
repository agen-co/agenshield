/**
 * Seatbelt Profile Management
 *
 * Re-exports from @agenshield/seatbelt — all profile generation
 * is consolidated there.
 */

export {
  generateAgentProfile,
  generateOperationProfile,
  installProfiles,
  verifyProfile,
  installSeatbeltProfiles,
  generateAgentProfileFromConfig,
  generateAgentProfile_v2,
  getInstalledProfiles,
  type ProfileResult,
} from '@agenshield/seatbelt';
