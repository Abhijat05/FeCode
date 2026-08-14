import type { Skill, SkillRegistry } from "./types.js";
import type { ProjectContext } from "../project/types.js";
import { recommendSkillsFromRequest } from "./requestRecommender.js";

export interface ActivatedSkills {
  skills: Skill[];
  reasons?: Record<string, string>;
}

export interface ActivationPolicyOptions {
  maxSkills?: number;
  minThreshold?: number;
}

export class SkillActivationPolicy {
  private maxSkills: number;
  private minThreshold: number;

  constructor(options: ActivationPolicyOptions = {}) {
    this.maxSkills = options.maxSkills ?? 3;
    // We set a minimum threshold. 
    // Exact name match gives 10. Activation phrase gives up to 8. 
    // Project Framework match gives 4.
    // A threshold of 5 means we require either an exact name match, an activation keyword (15), 
    // or a project framework match (4) PLUS some request relevance (1-2+).
    this.minThreshold = options.minThreshold ?? 5.0; 
  }

  public activate(
    request: string,
    registry: SkillRegistry,
    projectContext?: ProjectContext
  ): ActivatedSkills {
    const recommendations = recommendSkillsFromRequest({
      request,
      registry,
      projectContext,
      maxResults: this.maxSkills
    });

    const activeSkills: Skill[] = [];
    const reasons: Record<string, string> = {};

    for (const rec of recommendations) {
      if (rec.score >= this.minThreshold) {
        activeSkills.push(rec.skill);
        reasons[rec.skill.name] = `Score: ${rec.score.toFixed(2)}`;
      }
    }

    return {
      skills: activeSkills,
      reasons
    };
  }
}
