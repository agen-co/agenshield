/**
 * Discovery module — binary and skill scanning
 */

export { scanDiscovery } from './scanner';
export {
  scanBinaries,
  classifyDirectory,
  detectNpmGlobalBin,
  detectYarnGlobalBin,
  getProtection,
  isShieldExecLink,
  categorize,
} from './binary-scanner';
export {
  scanSkills,
  parseSkillMd,
  extractCommands,
  extractSkillInfo,
  getApprovalStatus,
  stripEnvFromSkillMd,
} from './skill-scanner';
