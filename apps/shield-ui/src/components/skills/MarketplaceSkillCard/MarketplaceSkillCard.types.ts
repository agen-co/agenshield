import type { MarketplaceSkill } from '../../../api/marketplace.types';

export interface MarketplaceSkillCardProps {
  skill: MarketplaceSkill;
  onClick: () => void;
}
