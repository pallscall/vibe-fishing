import path from 'node:path'
import { loadSkills, resolveSkillsPath } from '../skills/loader'
import { getSkillsContainerPath } from '../sandbox/threadData'

export const MASTER_AGENT_PROMPT = `You are master agent, the orchestrator for Vibe Fishing.

Workflow:
- Clarify ambiguities before acting. If unsure, ask a direct question.
- State assumptions explicitly when details are missing.
- Provide concise, structured responses for complex tasks.
- For code, provide complete, runnable snippets without placeholders.
- Avoid unnecessary meta commentary.`

export const buildSkillSystemSection = () => {
  const skills = loadSkills().filter((skill) => skill.enabled)
  if (!skills.length) return ''
  const skillsRoot = resolveSkillsPath()
  const containerPath = getSkillsContainerPath()
  const skillItems = skills
    .map(
      (skill) => {
        const relativePath = path.relative(skillsRoot, skill.filePath).split(path.sep).join('/')
        const location = path.posix.join(containerPath, relativePath)
        return `    <skill>\n        <name>${skill.name}</name>\n        <description>${skill.description ?? ''}</description>\n        <location>${location}</location>\n    </skill>`
      }
    )
    .join('\n')
  return `<skill_system>
You have access to skills that provide optimized workflows for specific tasks. Each skill contains best practices, frameworks, and references to additional resources.

Progressive Loading:
1. When a user query matches a skill's use case, immediately call read_file with the skill's location below
2. Read and understand the skill's workflow and instructions
3. Load referenced resources only when needed during execution
4. Follow the skill's instructions precisely

Skills are located under: ${containerPath}

<available_skills>
${skillItems}
</available_skills>
</skill_system>`
}
