/**
 * CareerCoach API Client
 * ======================
 * Centralised fetch wrapper for all FastAPI backend calls.
 *
 * Configuration
 * -------------
 * Set VITE_API_URL in a .env file to override the default base URL:
 *   VITE_API_URL=http://my-server:8000
 *
 * Functions
 * ---------
 *   analyzeProfile(formData)          POST /analyze-profile   (multipart)
 *   generateCareerPlan(data)          POST /generate-career-plan
 *   evaluateTask(data)                POST /submit-task
 */

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

/**
 * Shared response handler — throws a descriptive Error on non-2xx status.
 * @param {Response} res
 * @returns {Promise<any>}
 */
async function _handleResponse(res) {
  if (!res.ok) {
    let message = `Server error (HTTP ${res.status})`
    try {
      const body = await res.json()
      message = body.detail ?? JSON.stringify(body)
    } catch {
      // ignore JSON parse failures — keep the generic message
    }
    throw new Error(message)
  }
  return res.json()
}

/**
 * Analyze a user's resume / GitHub profile and extract skills.
 *
 * @param {FormData} formData  Fields: `resume` (File, optional),
 *                             `github_username` (string, optional)
 * @returns {Promise<ProfileAnalysisResponse>}
 */
export async function analyzeProfile(formData) {
  const res = await fetch(`${BASE_URL}/analyze-profile`, {
    method: 'POST',
    body: formData,   // let the browser set Content-Type (multipart boundary)
  })
  return _handleResponse(res)
}

/**
 * Run the full career-plan pipeline: gap analysis + 30-day roadmap.
 *
 * @param {{ user_skills: string[], selected_role: string }} data
 * @returns {Promise<GenerateCareerPlanResponse>}
 *   { alignment_score, missing_skills, roadmap, capstone, review }
 */
export async function generateCareerPlan(data) {
  const res = await fetch(`${BASE_URL}/generate-career-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return _handleResponse(res)
}

/**
 * Submit a task answer for AI evaluation and XP reward.
 *
 * @param {{ user_id: string, submission_text: string }} data
 * @returns {Promise<SubmitTaskResponse>}
 *   { xp, level, rank, streak, execution_score, feedback }
 */
export async function evaluateTask(data) {
  const res = await fetch(`${BASE_URL}/submit-task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return _handleResponse(res)
}

/**
 * Generate a personalised daily challenge via the new QUEST agent.
 * Automatically targets gap skills (65%) and known skills (35%).
 *
 * @param {string} userId
 * @param {string|null} skill   Override target skill (optional)
 * @param {boolean} forceGap   Force a gap-skill challenge
 */
export async function getDailyChallenge(userId, skill = null, forceGap = false) {
  const params = new URLSearchParams()
  if (skill) params.set('skill', skill)
  if (forceGap) params.set('force_gap', 'true')
  const qs = params.toString() ? `?${params}` : ''
  const res = await fetch(`${BASE_URL}/agent/challenge/${userId}${qs}`)
  return _handleResponse(res)
}

/**
 * Evaluate a user's daily challenge answer.
 * Applies mastery formula: new_mastery = prev*0.7 + score/100*4*0.3
 *
 * @param {string} userId
 * @param {object} challenge  Challenge object returned by getDailyChallenge
 * @param {string} answer     User's text answer
 */
export async function evaluateDailyChallenge(userId, challenge, answer) {
  const res = await fetch(`${BASE_URL}/agent/challenge/${userId}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge, answer }),
  })
  return _handleResponse(res)
}

/**
 * Generate an AI challenge question for a given skill.
 *
 * @param {string} skill  The skill to generate a challenge for.
 * @returns {Promise<{skill: string, question: string}>}
 */
export async function generateChallenge(skill) {
  const res = await fetch(`${BASE_URL}/verify-skill/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skill }),
  })
  return _handleResponse(res)
}

/**
 * Compute skill impact scores for a target role.
 *
 * @param {{ user_skills: string[], target_role: string, user_id?: string }} data
 * @returns {Promise<SkillImpactResponse>}
 */
export async function getSkillImpact(data) {
  const res = await fetch(`${BASE_URL}/skill-impact`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return _handleResponse(res)
}

/**
 * Refresh live market data from RemoteOK, JSearch (Indeed/LinkedIn/Glassdoor), and Adzuna.
 *
 * @returns {Promise<{ roles_updated, total_jobs_processed, sources, elapsed_s, written }>}
 */
export async function refreshMarketData() {
  const res = await fetch(`${BASE_URL}/market/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  return _handleResponse(res)
}

export async function getLearningResources(topic, skill, role) {
  const res = await fetch(`${BASE_URL}/get-resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ topic, skill, role: role || '' }),
  })
  return _handleResponse(res)
}

/**
 * Fetch per-skill mastery levels for a user from the Mastery Tracker.
 *
 * @param {string} userId
 * @returns {Promise<{ user_id: string, mastery_levels: Array<{skill,level,level_name,mastery_discount,skill_xp}> }>}
 */
export async function getUserMastery(userId) {
  const res = await fetch(`${BASE_URL}/user/${userId}/mastery`)
  return _handleResponse(res)
}

/**
 * Run the full Agentic Intelligence Loop for a user.
 *
 * This is the core of the agentic AI system — it does:
 *   OBSERVE → REASON → PLAN → ACT → REFLECT
 *
 * Unlike all other API calls (which are reactive — called by user clicks),
 * this is called proactively on a timer so the agent continuously works
 * toward the user's career goal without waiting for interaction.
 *
 * @param {string} userId
 * @returns {Promise<AgentLoopReport>}
 */
export async function runAgentLoop(userId) {
  const res = await fetch(`${BASE_URL}/agent/run/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  return _handleResponse(res)
}

/**
 * Fetch the last saved profile scan result for a user from DynamoDB.
 * @param {string} userId
 * @returns {Promise<ProfileAnalysisResponse|null>}
 */
export async function getProfileScan(userId) {
  const res = await fetch(`${BASE_URL}/profile-scan/${userId}`)
  if (res.status === 404) return null
  return _handleResponse(res)
}

/**
 * Fetch the last saved role-gap analysis result for a user from DynamoDB.
 * @param {string} userId
 * @returns {Promise<AnalyzeRoleResponse|null>}
 */
export async function getPersistedRoleGap(userId) {
  const res = await fetch(`${BASE_URL}/role-gap/${userId}`)
  if (res.status === 404) return null
  return _handleResponse(res)
}

/**
 * Kick off async roadmap generation.
 * Returns immediately with {"status": "generating"}.
 * Frontend should poll getPersistedRoadmap() until status is "ready".
 *
 * @param {{ user_id, user_skills, target_role, missing_skills, mastery_levels, github_username, completed_projects }} data
 * @returns {Promise<{status: string, target_role: string}>}
 */
export async function generateDynamicRoadmap(data) {
  const res = await fetch(`${BASE_URL}/roadmap/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return _handleResponse(res)
}

/**
 * Fetch the last persisted dynamic roadmap for a user from DynamoDB.
 * @param {string} userId
 * @returns {Promise<GenerateDynamicRoadmapResponse|null>}
 */
export async function getPersistedRoadmap(userId) {
  const res = await fetch(`${BASE_URL}/roadmap/${userId}`)
  if (res.status === 404) return null
  return _handleResponse(res)
}

/**
 * Submit a project GitHub URL for REVIEW agent evaluation.
 * Awards XP and marks the phase complete in DynamoDB.
 *
 * @param {string} userId
 * @param {number} phaseIdx  0-based phase index
 * @param {string} githubRepoUrl
 * @returns {Promise<EvaluationResult>}
 */
export async function submitPhaseProject(userId, phaseIdx, githubRepoUrl) {
  const res = await fetch(`${BASE_URL}/roadmap/${userId}/phase/${phaseIdx}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ github_repo_url: githubRepoUrl }),
  })
  return _handleResponse(res)
}

/**
 * Sync the frontend's computed allKnownSkills to DynamoDB so the
 * agentic loop and all agents always have the latest skill set.
 * @param {string} userId
 * @param {string[]} skills
 */
export async function syncSkills(userId, skills) {
  const res = await fetch(`${BASE_URL}/sync-skills/${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skills }),
  })
  return _handleResponse(res)
}
