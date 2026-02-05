import type { Test } from 'jest-runner';
import { default as Sequencer } from '@jest/test-sequencer';

/**
 * Custom test sequencer that sorts tests alphabetically by file path.
 * This enforces numbered execution order (01-, 02-, 03-, etc.).
 */
export default class AlphabeticalSequencer extends Sequencer {
  sort(tests: Array<Test>): Array<Test> {
    return [...tests].sort((a, b) => a.path.localeCompare(b.path));
  }
}
