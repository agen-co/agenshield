/**
 * MDM org config reader/writer
 *
 * Re-exports from @agenshield/cloud for backward compatibility.
 * Core implementation now lives in the @agenshield/cloud library.
 */

export {
  loadMdmConfig,
  saveMdmConfig,
  hasMdmConfig,
} from '@agenshield/cloud';

export type { MdmOrgConfig } from '@agenshield/cloud';
