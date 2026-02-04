/**
 * Skill Registry
 *
 * Manages loaded skills.
 */

import type { Skill } from './types.js';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  /**
   * Register a skill
   */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * Register multiple skills
   */
  registerAll(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * Unregister a skill
   */
  unregister(name: string): boolean {
    return this.skills.delete(name);
  }

  /**
   * Get a skill by name
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Check if a skill exists
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * List all skills
   */
  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * List user-invocable skills
   */
  listUserInvocable(): Skill[] {
    return this.list().filter((skill) => skill.userInvocable);
  }

  /**
   * List model-invocable skills
   */
  listModelInvocable(): Skill[] {
    return this.list().filter((skill) => !skill.disableModelInvocation);
  }

  /**
   * Find skills matching a filter
   */
  find(filter: Partial<Skill>): Skill[] {
    return this.list().filter((skill) => {
      for (const [key, value] of Object.entries(filter)) {
        if (skill[key as keyof Skill] !== value) {
          return false;
        }
      }
      return true;
    });
  }

  /**
   * Clear all skills
   */
  clear(): void {
    this.skills.clear();
  }

  /**
   * Get skill count
   */
  get size(): number {
    return this.skills.size;
  }
}
