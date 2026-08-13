import type { Skill } from "../types.js";
import { SkillLoader } from "../loader.js";

const loader = new SkillLoader();
export const frontendDesignSkill: Skill = loader.loadBuiltinSkillSync("frontend-design");
