import { useState, useRef, useEffect } from 'react'
import './App.css'
import { analyzeProfile, generateCareerPlan, evaluateTask, generateChallenge, getDailyChallenge, evaluateDailyChallenge, getSkillImpact, refreshMarketData, getLearningResources, getUserMastery, runAgentLoop, getProfileScan, getPersistedRoleGap, generateDynamicRoadmap, getPersistedRoadmap, submitPhaseProject, syncSkills } from './api/careerCoachApi'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  AreaChart,
  Area
} from 'recharts'
import {
  LayoutDashboard,
  ScanFace,
  Target,
  Map,
  Swords,
  BarChart2,
  Flame,
  Zap,
  Trophy,
  ChevronRight,
  TrendingUp,
  Award,
  Lock,
  Menu,
  Upload,
  Github,
  Sparkles,
  FileText,
  Users,
  ExternalLink,
  BookOpen,
  Cpu
} from 'lucide-react'

const _getOb = () => { try { return JSON.parse(localStorage.getItem('careeros_onboarding')) } catch { return null } }

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [scanResult, setScanResult] = useState(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [userAddedSkills, setUserAddedSkills] = useState(() => {
    try { return JSON.parse(localStorage.getItem('careeros_added_skills') || '[]') } catch { return [] }
  })
  const [gapResult, setGapResult] = useState(() => {
    try { return JSON.parse(localStorage.getItem('careeros_gap_result')) } catch { return null }
  })
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)

  const [onboardingData, setOnboardingData] = useState(_getOb)
  const [userName, setUserName] = useState(() => _getOb()?.name || localStorage.getItem('careeros_username') || '')
  const [selectedRole, setSelectedRole] = useState(() => _getOb()?.targetRole || '')
  const [masteryData, setMasteryData] = useState(null)
  const [marketStats, setMarketStats] = useState(() => {
    try { return JSON.parse(localStorage.getItem('careeros_market_stats') || 'null') } catch { return null }
  })

  // ── Agentic Intelligence Loop state ──────────────────────────────────────
  const [agentReport, setAgentReport] = useState(null)
  const [agentRunning, setAgentRunning] = useState(false)
  const [agentLog, setAgentLog] = useState([])  // history of last N agent runs
  const [agentStep, setAgentStep] = useState(null)  // current step: OBSERVE|REASON|PLAN|ACT|REFLECT
  const [questMapKey, setQuestMapKey] = useState(0) // bump to force QuestMap re-mount (auto-advance)

  // Helper: update gapResult + persist to localStorage
  const updateGapResult = (data) => {
    setGapResult(data)
    if (data) {
      try { localStorage.setItem('careeros_gap_result', JSON.stringify(data)) } catch {}
    } else {
      localStorage.removeItem('careeros_gap_result')
    }
  }

  const handleOnboardingComplete = async (data) => {
    // Strip the File object before persisting (not serialisable)
    const { resumeFile, ...persistable } = data
    localStorage.setItem('careeros_onboarding', JSON.stringify(persistable))
    localStorage.setItem('careeros_username', data.name)
    setOnboardingData(persistable)
    setUserName(data.name)
    if (data.targetRole) setSelectedRole(data.targetRole)

    // Kick off profile scan in background
    let profileSkills = []
    if (resumeFile || data.githubUsername) {
      setScanLoading(true)
      try {
        const fd = new FormData()
        if (resumeFile) fd.append('resume', resumeFile)
        if (data.githubUsername) fd.append('github_username', data.githubUsername)
        fd.append('user_id', 'user_1')
        const result = await analyzeProfile(fd)
        setScanResult(result)
        profileSkills = [
          ...(result?.technical_skills || []),
          ...(result?.github_analysis?.primary_languages || []),
        ]
      } catch (e) { console.error('Onboarding scan failed', e) } finally {
        setScanLoading(false)
      }
    }

    // Auto-run Role Gap Analysis if a target role was selected
    if (data.targetRole) {
      setActiveTab('role-gap')
      const allSkills = [...new Set([...profileSkills, ...userAddedSkills])]
      try {
        const response = await fetch(`${BASE_URL}/analyze-role`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_skills: allSkills, selected_role: data.targetRole, user_id: 'user_1' }),
        })
        if (response.ok) {
          const gapData = await response.json()
          updateGapResult(gapData)
          // Navigate to Quest Map — it will auto-generate the roadmap
          setActiveTab('quest-map')
        }
      } catch (e) { console.error('Auto role-gap failed', e) }
    } else {
      setActiveTab('profile-scan')
    }
  }

  const handleSetName = (name) => {
    setUserName(name)
    localStorage.setItem('careeros_username', name)
  }

  const fetchMetrics = async () => {
    try {
      const resp = await fetch(`${BASE_URL}/metrics/user_1`)
      const data = await resp.json()
      setMetrics(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMetrics()
    // Load saved profile scan from DynamoDB on mount
    getProfileScan('user_1').then(r => { if (r) setScanResult(r) }).catch(() => {})
    // Load saved role gap result from DynamoDB on mount (ensures Quest Map works on reload)
    if (!gapResult) {
      getPersistedRoleGap('user_1').then(r => { if (r) updateGapResult(r) }).catch(() => {})
    }
  }, [])

  // Auto-sync market data if cache is empty or older than 2 hours
  // ── Market data: fetch once on mount, then every 2 hours ─────────────────
  useEffect(() => {
    const fetchMarket = () => {
      refreshMarketData().then(data => {
        const stats = { ...data, refreshed_at: new Date().toISOString() }
        setMarketStats(stats)
        localStorage.setItem('careeros_market_stats', JSON.stringify(stats))
      }).catch(() => {})
    }
    // Only fetch if cache is stale (>2h) or empty
    const TWO_HOURS = 2 * 60 * 60 * 1000
    const stale = !marketStats?.refreshed_at ||
      Date.now() - new Date(marketStats.refreshed_at).getTime() > TWO_HOURS
    if (stale) fetchMarket()
    const interval = setInterval(fetchMarket, TWO_HOURS)
    return () => clearInterval(interval)
  }, [])

  // ── Mastery data: fetch once on mount, then every 60s ── ────────────────
  useEffect(() => {
    getUserMastery('user_1').then(setMasteryData).catch(() => {})
    const interval = setInterval(() => {
      getUserMastery('user_1').then(setMasteryData).catch(() => {})
    }, 60000)
    return () => clearInterval(interval)
  }, [])

  // ── Agentic Intelligence Loop — polls autonomously every 45 seconds ──────
  // Unlike all other calls (which are user-triggered), this runs on a timer.
  // The agent wakes up, observes the user's state, reasons with the LLM,
  // plans tool calls, executes them, and reflects — all without user interaction.
  const triggerAgentLoop = async () => {
    if (agentRunning) return
    setAgentRunning(true)
    const steps = ['OBSERVE', 'REASON', 'PLAN', 'ACT', 'REFLECT']
    let i = 0
    const stepTimer = setInterval(() => {
      setAgentStep(steps[i])
      i++
      if (i >= steps.length) clearInterval(stepTimer)
    }, 600)
    try {
      const report = await runAgentLoop('user_1')
      setAgentReport(report)
      setAgentLog(prev => [report, ...prev].slice(0, 8))
      // If agent updated priority skill, reload metrics
      if (report?.outcomes?.next_priority_skill) {
        fetch(`${BASE_URL}/metrics/user_1`).then(r => r.json()).then(setMetrics).catch(() => {})
      }
    } catch (e) {
      // non-fatal — agent runs in background
    } finally {
      clearInterval(stepTimer)
      setAgentStep(null)
      setAgentRunning(false)
    }
  }

  useEffect(() => {
    // Run once on mount, then every 45 seconds
    triggerAgentLoop()
    const interval = setInterval(triggerAgentLoop, 1200000) // every 20 minutes — reduces Bedrock quota contention
    return () => clearInterval(interval)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Single source-of-truth for "all skills this user knows"
  // Merges: profile scan results + practised skills from backend + manually entered chips
  const allKnownSkills = [...new Set([
    ...(scanResult?.technical_skills || []),
    ...(scanResult?.github_analysis?.primary_languages || []),
    ...(metrics?.learned_skills || []),
    ...userAddedSkills,
  ])]

  // Sync allKnownSkills to DynamoDB whenever the combined set changes
  // so the agentic loop always sees the latest skills
  const allSkillsKey = allKnownSkills.slice().sort().join('|')
  const prevSkillsKey = useRef('')
  useEffect(() => {
    if (allSkillsKey && allSkillsKey !== prevSkillsKey.current) {
      prevSkillsKey.current = allSkillsKey
      syncSkills('user_1', allKnownSkills).catch(() => {})
    }
  }, [allSkillsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="loading-state"><Sparkles className="spin" /></div>

  return (
    <div className="app-container">
      {!onboardingData && <Onboarding onComplete={handleOnboardingComplete} />}
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} metrics={metrics} />
      <main className="main-content">
        <DashboardHeader metrics={metrics} />

        {activeTab === 'dashboard' && <Dashboard metrics={metrics} setActiveTab={setActiveTab} userName={userName} onSetName={handleSetName} masteryData={masteryData} marketStats={marketStats} />}
        {activeTab === 'profile-scan' && (
          <ProfileScan result={scanResult} setResult={setScanResult} loading={scanLoading} />
        )}
        {activeTab === 'role-gap' && (
          <RoleGap
            userSkills={allKnownSkills}
            userAddedSkills={userAddedSkills}
            onAddSkill={(s) => {
              const updated = [...new Set([...userAddedSkills, s])]
              setUserAddedSkills(updated)
              localStorage.setItem('careeros_added_skills', JSON.stringify(updated))
            }}
            onRemoveSkill={(s) => {
              const updated = userAddedSkills.filter(x => x !== s)
              setUserAddedSkills(updated)
              localStorage.setItem('careeros_added_skills', JSON.stringify(updated))
            }}
            gapResult={gapResult}
            setGapResult={updateGapResult}
            selectedRole={selectedRole}
            setSelectedRole={setSelectedRole}
            marketStats={marketStats}
            setMarketStats={(stats) => {
              setMarketStats(stats)
              localStorage.setItem('careeros_market_stats', JSON.stringify(stats))
            }}
          />
        )}
        {activeTab === 'quest-map' && (
          <QuestMap
            key={questMapKey}
            gapResult={gapResult}
            userSkills={allKnownSkills}
            selectedRole={selectedRole}
            masteryData={masteryData}
            userId="user_1"
            fetchMetrics={fetchMetrics}
            onRoadmapComplete={(newSkills) => {
              if (!newSkills?.length) return
              const updated = [...new Set([...userAddedSkills, ...newSkills])]
              setUserAddedSkills(updated)
              localStorage.setItem('careeros_added_skills', JSON.stringify(updated))
              // Re-fetch metrics so dashboard + stats reflect new XP/level
              fetchMetrics()

              // ── Agentic auto-advance: re-analyze gap → generate next roadmap ──
              if (selectedRole) {
                // Build updated skill list including newly learned skills
                const latestSkills = [...new Set([
                  ...(scanResult?.technical_skills || []),
                  ...(scanResult?.github_analysis?.primary_languages || []),
                  ...updated,
                  ...(metrics?.learned_skills || []),
                ])]
                // 3-second delay so user sees the completion celebration
                setTimeout(async () => {
                  try {
                    const resp = await fetch(`${BASE_URL}/analyze-role`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ user_skills: latestSkills, selected_role: selectedRole, user_id: 'user_1' }),
                    })
                    if (resp.ok) {
                      const newGap = await resp.json()
                      // Only auto-advance if there are still missing skills to learn
                      if (newGap.missing_skills?.length > 0) {
                        updateGapResult(newGap)
                        // Force QuestMap remount so it auto-generates a new roadmap
                        setQuestMapKey(prev => prev + 1)
                      }
                    }
                  } catch (e) { console.error('Auto-advance role-gap failed', e) }
                }, 3000)
              }
            }}
          />
        )}
        {activeTab === 'daily-quest' && (
          <DailyQuest
            onComplete={fetchMetrics}
            selectedRole={selectedRole}
            allUserSkills={allKnownSkills}
            nextPrioritySkill={metrics?.next_priority_skill}
          />
        )}
        {activeTab === 'stats' && (
          <PlayerStats metrics={metrics} fetchMetrics={fetchMetrics} selectedRole={selectedRole} scanResult={scanResult} masteryData={masteryData} userName={userName} />
        )}
        {/* Placeholders for other tabs */}
        {activeTab !== 'dashboard' && activeTab !== 'profile-scan' && activeTab !== 'role-gap' && activeTab !== 'quest-map' && activeTab !== 'daily-quest' && activeTab !== 'stats' && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            Feature coming soon...
          </div>
        )}
      </main>
    </div>
  )
}


// ─── Onboarding data ────────────────────────────────────────────────────────
const ONBOARDING_ROLES = [
  { id: 'Backend Developer',         icon: '⚙️', desc: 'APIs, databases, system design' },
  { id: 'Frontend Developer',        icon: '🎨', desc: 'UI, React, user experience' },
  { id: 'Full Stack Developer',      icon: '💻', desc: 'Frontend + Backend combined' },
  { id: 'Data Analyst',              icon: '📊', desc: 'SQL, Excel, visualization' },
  { id: 'Machine Learning Engineer', icon: '🤖', desc: 'ML, PyTorch, model deployment' },
  { id: 'DevOps Engineer',           icon: '🚀', desc: 'CI/CD, Docker, Kubernetes' },
]
const ONBOARDING_SEGMENTS = [
  { id: 'student',      label: 'University Student',   icon: '🎓', desc: 'Building skills to land my first job' },
  { id: 'self_learner', label: 'Self-Learner',         icon: '📚', desc: 'Learning on my own schedule' },
  { id: 'professional', label: 'Working Professional', icon: '💼', desc: 'Upskilling or switching roles' },
]
const ONBOARDING_HOURS = [5, 10, 20, 30]
const ONBOARDING_DURATIONS = [1, 3, 6, 12]

// ─── Onboarding wizard ──────────────────────────────────────────────────────
const Onboarding = ({ onComplete }) => {
  const [step, setStep] = useState(1)
  const TOTAL = 5
  const [form, setForm] = useState({ name: '', segment: '', targetRole: '', weeklyHours: 10, durationMonths: 3, resumeFile: null, githubUsername: '' })
  const resumeRef = useRef(null)

  const canNext = () => {
    if (step === 1) return form.name.trim().length > 0
    if (step === 2) return form.segment !== ''
    if (step === 3) return form.targetRole !== ''
    return true   // step 4 (commitment) + step 5 (resume/github) always passable
  }

  const skip = () => onComplete({ name: 'Adventurer', segment: 'self_learner', targetRole: '', weeklyHours: 10, durationMonths: 3, resumeFile: null, githubUsername: '' })

  const btnBase = {
    padding: '0.65rem 1.75rem', borderRadius: '10px', cursor: 'pointer',
    fontWeight: 700, border: 'none', fontSize: '0.9rem', transition: 'all 0.2s'
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.93)', backdropFilter: 'blur(10px)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      <div style={{
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: '20px', width: '540px', maxWidth: '94vw',
        padding: '2.5rem', boxShadow: '0 24px 80px rgba(0,0,0,0.6)'
      }}>

        {/* Progress bar */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '2rem' }}>
          {Array.from({ length: TOTAL }).map((_, i) => (
            <div key={i} style={{
              flex: 1, height: '4px', borderRadius: '2px',
              background: i < step ? 'var(--accent-primary)' : 'var(--border-color)',
              transition: 'background 0.3s'
            }} />
          ))}
        </div>

        {/* Step 1 — Name */}
        {step === 1 && (
          <div>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>👋</div>
            <h2 style={{ margin: '0 0 0.5rem' }}>Welcome to <span style={{ color: 'var(--accent-primary)' }}>Career Coach</span></h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
              AI-powered career acceleration. Skill gaps → ranked roadmap → eat the frog → verified mastery.
            </p>
            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>What should we call you?</label>
            <input
              autoFocus
              className="custom-input"
              style={{ width: '100%', boxSizing: 'border-box' }}
              placeholder="Your name"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && canNext() && setStep(2)}
            />
          </div>
        )}

        {/* Step 2 — Segment */}
        {step === 2 && (
          <div>
            <h2 style={{ margin: '0 0 0.4rem' }}>Who are you, <span style={{ color: 'var(--accent-primary)' }}>{form.name}</span>?</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>Tailors difficulty and learning pace for you.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {ONBOARDING_SEGMENTS.map(s => (
                <div key={s.id}
                  onClick={() => setForm(f => ({ ...f, segment: s.id }))}
                  style={{
                    padding: '1rem 1.25rem', borderRadius: '12px', cursor: 'pointer',
                    border: `2px solid ${form.segment === s.id ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: form.segment === s.id ? 'rgba(0,240,255,0.08)' : 'var(--bg-tertiary)',
                    display: 'flex', alignItems: 'center', gap: '1rem', transition: 'all 0.2s'
                  }}>
                  <span style={{ fontSize: '1.6rem' }}>{s.icon}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{s.label}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{s.desc}</div>
                  </div>
                  {form.segment === s.id && <span style={{ marginLeft: 'auto', color: 'var(--accent-primary)', fontSize: '1.1rem' }}>✓</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 3 — Target role */}
        {step === 3 && (
          <div>
            <h2 style={{ margin: '0 0 0.4rem' }}>Your <span style={{ color: 'var(--accent-primary)' }}>target role</span>?</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>We build your skill gap analysis around this.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
              {ONBOARDING_ROLES.map(r => (
                <div key={r.id}
                  onClick={() => setForm(f => ({ ...f, targetRole: r.id }))}
                  style={{
                    padding: '1rem', borderRadius: '12px', cursor: 'pointer', textAlign: 'center',
                    border: `2px solid ${form.targetRole === r.id ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: form.targetRole === r.id ? 'rgba(0,240,255,0.08)' : 'var(--bg-tertiary)',
                    transition: 'all 0.2s'
                  }}>
                  <div style={{ fontSize: '1.8rem', marginBottom: '0.4rem' }}>{r.icon}</div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{r.id}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.25rem' }}>{r.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Step 4 — Time commitment */}
        {step === 4 && (
          <div>
            <h2 style={{ margin: '0 0 0.4rem' }}>Time <span style={{ color: 'var(--accent-primary)' }}>commitment</span></h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>Calibrates your roadmap pace and task depth.</p>

            <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Weekly hours available</label>
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1.5rem' }}>
              {ONBOARDING_HOURS.map(h => (
                <button key={h} onClick={() => setForm(f => ({ ...f, weeklyHours: h }))}
                  style={{
                    ...btnBase, flex: 1, padding: '0.6rem 0',
                    border: `2px solid ${form.weeklyHours === h ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: form.weeklyHours === h ? 'rgba(0,240,255,0.1)' : 'var(--bg-tertiary)',
                    color: 'var(--text-primary)'
                  }}>{h}h</button>
              ))}
            </div>

            <label style={{ display: 'block', marginBottom: '0.6rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>Target duration</label>
            <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '2rem' }}>
              {ONBOARDING_DURATIONS.map(d => (
                <button key={d} onClick={() => setForm(f => ({ ...f, durationMonths: d }))}
                  style={{
                    ...btnBase, flex: 1, padding: '0.6rem 0',
                    border: `2px solid ${form.durationMonths === d ? 'var(--accent-secondary)' : 'var(--border-color)'}`,
                    background: form.durationMonths === d ? 'rgba(34,197,94,0.1)' : 'var(--bg-tertiary)',
                    color: 'var(--text-primary)'
                  }}>{d}mo</button>
              ))}
            </div>

            <div style={{
              padding: '1rem 1.25rem', borderRadius: '12px',
              background: 'rgba(0,240,255,0.06)', border: '1px solid rgba(0,240,255,0.2)',
              fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.7
            }}>
              🎯 <strong style={{ color: 'var(--accent-primary)' }}>{form.name}</strong>{' '}·{' '}
              {ONBOARDING_SEGMENTS.find(s => s.id === form.segment)?.label}{' '}·{' '}
              {form.targetRole}{' '}·{' '}
              {form.weeklyHours}h/week · {form.durationMonths} month{form.durationMonths > 1 ? 's' : ''}
            </div>
          </div>
        )}

        {/* Step 5 — Resume + GitHub */}
        {step === 5 && (
          <div>
            <h2 style={{ margin: '0 0 0.4rem' }}>Upload your <span style={{ color: 'var(--accent-primary)' }}>profile</span></h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
              We'll extract your skills automatically. Both are optional — you can always do this later.
            </p>

            <div
              onClick={() => resumeRef.current?.click()}
              style={{
                border: `2px dashed ${form.resumeFile ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                borderRadius: '12px', padding: '1.25rem', cursor: 'pointer', marginBottom: '1rem',
                background: form.resumeFile ? 'rgba(0,240,255,0.06)' : 'var(--bg-tertiary)',
                display: 'flex', alignItems: 'center', gap: '1rem', transition: 'all 0.2s'
              }}>
              <input type="file" ref={resumeRef} accept=".pdf" hidden
                onChange={e => setForm(f => ({ ...f, resumeFile: e.target.files?.[0] || null }))} />
              <span style={{ fontSize: '1.6rem' }}>📄</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {form.resumeFile ? form.resumeFile.name : 'Upload Resume PDF'}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                  {form.resumeFile ? '✓ Ready to scan' : 'Click to choose a PDF'}
                </div>
              </div>
              {form.resumeFile && (
                <span onClick={e => { e.stopPropagation(); setForm(f => ({ ...f, resumeFile: null })) }}
                  style={{ marginLeft: 'auto', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.1rem' }}>✕</span>
              )}
            </div>

            <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>GitHub Username</label>
            <div style={{ position: 'relative' }}>
              <span style={{ position: 'absolute', left: '0.85rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '0.9rem' }}>@</span>
              <input
                className="custom-input"
                style={{ width: '100%', boxSizing: 'border-box', paddingLeft: '2rem' }}
                placeholder="e.g. octocat"
                value={form.githubUsername}
                onChange={e => setForm(f => ({ ...f, githubUsername: e.target.value }))}
              />
            </div>
            {!form.resumeFile && !form.githubUsername && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '1rem', textAlign: 'center' }}>
                You can skip this and add your profile later from the Profile Scan tab.
              </p>
            )}
          </div>
        )}



        {/* Navigation */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem' }}>
          {step > 1
            ? <button onClick={() => setStep(s => s - 1)}
                style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-muted)', padding: '0.6rem 1.2rem', borderRadius: '10px', cursor: 'pointer', fontSize: '0.9rem' }}>
                ← Back
              </button>
            : <button onClick={skip}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline' }}>
                Skip setup
              </button>
          }
          {step < TOTAL
            ? <button onClick={() => setStep(s => s + 1)} disabled={!canNext()}
                style={{ ...btnBase, background: canNext() ? 'var(--accent-primary)' : 'var(--border-color)', color: canNext() ? '#000' : 'var(--text-muted)' }}>
                Continue →
              </button>
            : <button onClick={() => onComplete(form)}
                style={{ ...btnBase, background: 'var(--accent-primary)', color: '#000' }}>
                🚀 Start My Journey
              </button>
          }
        </div>
      </div>
    </div>
  )
}

const MASTERY_COLORS = {
  0: '#6B7280',
  1: '#8B5CF6',
  2: '#00F0FF',
  3: '#22C55E',
  4: '#F59E0B',
}

const RANK_META = {
  bronze:   { emoji: '🥉', img: 'https://em-content.zobj.net/source/apple/391/3rd-place-medal_1f949.png', color: '#CD7F32', glow: 'rgba(205,127,50,0.55)' },
  silver:   { img: 'https://em-content.zobj.net/source/apple/391/2nd-place-medal_1f948.png', color: '#C0C0C0', glow: 'rgba(192,192,192,0.45)' },
  gold:     { img: 'https://em-content.zobj.net/source/apple/391/1st-place-medal_1f947.png', color: '#FFD700', glow: 'rgba(255,215,0,0.55)' },
  platinum: { emoji: '💠', color: '#E5E4E2', glow: 'rgba(229,228,226,0.4)' },
  diamond:  { emoji: '💎', color: '#00F0FF', glow: 'rgba(0,240,255,0.55)' },
}

const RankBadge = ({ rank, size = 48 }) => {
  const key = (rank || '').toLowerCase()
  const meta = RANK_META[key]
  const inner = meta?.img ? (
    <img
      src={meta.img}
      alt={rank}
      width={size}
      height={size}
      style={{ objectFit: 'contain', display: 'block', filter: `drop-shadow(0 0 6px ${meta?.color || '#aaa'})` }}
      onError={e => { e.target.style.display='none'; e.target.nextSibling.style.display='block' }}
    />
  ) : (
    <span style={{ fontSize: size * 0.9, lineHeight: 1, filter: meta ? `drop-shadow(0 0 6px ${meta.color})` : 'none' }}>
      {meta?.emoji || '🎖️'}
    </span>
  )
  return (
    <div style={{
      width: size + 20, height: size + 20,
      borderRadius: '50%',
      background: meta ? `radial-gradient(circle, ${meta.glow} 0%, transparent 72%)` : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      {inner}
      {meta?.img && <span style={{ display: 'none', fontSize: size * 0.9, lineHeight: 1 }}>{meta?.emoji || '🎖️'}</span>}
    </div>
  )
}

const CareerIntelligence = ({ metrics, masteryData, marketStats, setActiveTab }) => {
  const nextSkill = metrics?.next_priority_skill
  const totalJobs = marketStats?.total_jobs_processed
  const lastSyncedMs = marketStats?.refreshed_at
    ? Date.now() - new Date(marketStats.refreshed_at).getTime()
    : null
  const minsAgo = lastSyncedMs != null ? Math.floor(lastSyncedMs / 60000) : null

  return (
    <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>

      {/* Row 1: Next Priority Skill + Market Snapshot */}
      <div style={{ display: 'grid', gridTemplateColumns: nextSkill ? '1fr 1fr' : '1fr', gap: '1rem' }}>

        {nextSkill && (
          <div
            style={{
              padding: '1.25rem',
              background: 'linear-gradient(135deg, rgba(0,240,255,0.07) 0%, rgba(0,240,255,0.02) 100%)',
              border: '1px solid rgba(0,240,255,0.25)', borderRadius: '14px', marginBottom: '1.5rem',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,240,255,0.12)'; e.currentTarget.style.transform = 'translateY(-2px)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, rgba(0,240,255,0.08) 0%, rgba(0,240,255,0.03) 100%)'; e.currentTarget.style.transform = 'none' }}
          >
            <div style={{ fontSize: '0.68rem', color: 'var(--accent-primary)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              🎯 Your Coach Recommends
              <span style={{ background: 'rgba(0,240,255,0.15)', border: '1px solid rgba(0,240,255,0.35)', borderRadius: '999px', padding: '0.1rem 0.5rem', fontSize: '0.6rem', letterSpacing: '0.06em' }}>AI COACH</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.35rem', color: 'var(--text-primary)', lineHeight: 1.2 }}>{nextSkill}</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>Chosen based on real job market demand and where you have the biggest gap</div>
            <div style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: 'var(--accent-primary)', fontWeight: 700 }}>→ Go to Eat the Frog to start working on this</div>
          </div>
        )}

        <div style={{
          padding: '1.25rem',
          background: 'linear-gradient(135deg, rgba(34,197,94,0.07) 0%, rgba(34,197,94,0.02) 100%)',
          border: '1px solid rgba(34,197,94,0.25)', borderRadius: '14px',
        }}>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, marginBottom: '0.75rem' }}>
            📡 Live Market Intelligence
          </div>
          {marketStats ? (
            <>
              <div style={{ fontWeight: 800, fontSize: '1.6rem', color: 'var(--accent-secondary)', lineHeight: 1 }}>
                {totalJobs?.toLocaleString()}
                <span style={{ fontSize: '0.78rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: '0.45rem' }}>jobs analyzed</span>
              </div>
              <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.65rem', flexWrap: 'wrap' }}>
                {[['RemoteOK', marketStats.sources?.remoteok, '#22C55E'], ['Indeed/LI', marketStats.sources?.jsearch, '#00F0FF'], ['Adzuna', marketStats.sources?.adzuna, '#F59E0B']].filter(([, count]) => count == null || count > 0).map(([label, count, color]) => (
                  <span key={label} style={{ fontSize: '0.7rem', fontWeight: 700, color, background: `${color}18`, padding: '0.2rem 0.55rem', borderRadius: '999px', border: `1px solid ${color}30` }}>
                    {label}: {count ?? 0}
                  </span>
                ))}
              </div>
              {minsAgo != null && (
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '0.55rem' }}>
                  Updated {minsAgo < 2 ? 'just now' : minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`} · Weekly auto-refresh on
                </div>
              )}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', paddingTop: '0.5rem' }}>
              <Sparkles className="spin" size={14} /> Syncing live job market data…
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Mastery Tracker */}
      {masteryData?.mastery_levels?.length > 0 && (
        <div style={{ padding: '1.25rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
              ⚡ Mastery Tracker <span style={{ color: 'var(--accent-primary)', marginLeft: '0.5rem', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— {masteryData.mastery_levels.length} skills tracked</span>
            </div>
            <span
              onClick={() => setActiveTab('stats')}
              style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600 }}
            >View All →</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.65rem' }}>
            {masteryData.mastery_levels.slice(0, 6).map(item => (
              <div key={item.skill} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', minWidth: '90px', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.skill}</span>
                <div style={{ flex: 1, height: '5px', background: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${(item.level / 4) * 100}%`, background: MASTERY_COLORS[item.level] || 'var(--accent-primary)', borderRadius: '999px', transition: 'width 0.6s ease' }} />
                </div>
                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: MASTERY_COLORS[item.level], minWidth: '76px', textAlign: 'right' }}>{item.level_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const Dashboard = ({ metrics, setActiveTab, userName, onSetName, masteryData, marketStats }) => {
  return (
    <>
      <WelcomeSection metrics={metrics} userName={userName} onSetName={onSetName} />
      <CareerIntelligence metrics={metrics} masteryData={masteryData} marketStats={marketStats} setActiveTab={setActiveTab} />
      <StatsGrid metrics={metrics} />
      <ActionGrid setActiveTab={setActiveTab} />
      <CommunitiesSection metrics={metrics} />
    </>
  )
}

const ProfileScan = ({ result, loading }) => {
  // Colors for the chart matching your theme
  const COLORS = ['#00F0FF', '#22C55E', '#F59E0B', '#8B5CF6', '#EC4899']

  return (
    <div className="scan-container">
      <div className="scan-header">
        <div className="scan-title">
          <ScanFace size={32} color="var(--accent-primary)" />
          <h2>Profile Analysis</h2>
        </div>
        <p className="scan-subtitle">Skills and insights extracted from your resume and GitHub.</p>
      </div>

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', padding: '5rem 0' }}>
          <Sparkles className="spin" size={36} color="var(--accent-primary)" />
          <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem', margin: 0 }}>Analysing your profile…</p>
        </div>
      ) : !result ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', padding: '5rem 2rem', textAlign: 'center' }}>
          <span style={{ fontSize: '3rem' }}>📄</span>
          <h3 style={{ margin: 0 }}>No profile analysed yet</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '380px', lineHeight: 1.6, margin: 0 }}>
            Upload your resume or add your GitHub username during onboarding — your full skill analysis will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="results-container">

          {/* ── Summary + Stats ── */}
          {result.summary && (
            <div className="result-card" style={{ borderLeft: '3px solid var(--accent-primary)' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--accent-primary)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>AI SUMMARY</div>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, margin: 0 }}>{result.summary}</p>
            </div>
          )}

          <div className="result-card">
            <h3>Profile Overview</h3>
            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '0.75rem' }}>
              {[
                {
                  label: 'Experience',
                  value: result.years_of_experience != null ? `${result.years_of_experience} yrs` : '—',
                  color: 'var(--accent-primary)',
                  numeric: true,
                },
                {
                  label: 'Level',
                  value: result.experience_level
                    ? result.experience_level.charAt(0).toUpperCase() + result.experience_level.slice(1)
                    : '—',
                  color: 'var(--accent-secondary)',
                  numeric: false,
                },
                { label: 'Skills',         value: (result.skill_ratings?.length || result.technical_skills?.length || 0), color: 'var(--accent-primary)',  numeric: true },
                { label: 'Projects',       value: result.projects?.length || 0,                                         color: 'var(--accent-orange)',   numeric: true },
                { label: 'GitHub Repos',   value: result.github_analysis?.repo_count || 0,                              color: 'var(--accent-primary)',  numeric: true },
                { label: 'Certifications', value: result.certifications?.length || 0,                                   color: '#8B5CF6',                numeric: true },
              ].map(s => (
                <div key={s.label} className="stat-card" style={{ textAlign: 'center' }}>
                  <span className="stat-label">{s.label}</span>
                  <div style={{
                    color: s.color,
                    fontWeight: 800,
                    fontSize: s.numeric ? '1.6rem' : '1rem',
                    lineHeight: 1.2,
                    marginTop: '0.3rem',
                    wordBreak: 'break-word',
                  }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Skill Ratings ── */}
          {result.skill_ratings?.length > 0 && (
            <div className="result-card">
              <h3>Skill Ratings</h3>
              {(['Expert','Advanced','Intermediate','Beginner']).map(level => {
                const skills = result.skill_ratings.filter(s => s.level === level)
                if (!skills.length) return null
                const levelColor = level === 'Expert' ? '#F59E0B' : level === 'Advanced' ? '#22C55E' : level === 'Intermediate' ? '#00F0FF' : '#8B5CF6'
                return (
                  <div key={level} style={{ marginBottom: '1.25rem' }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: levelColor, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
                      {level} — {skills.length} skill{skills.length > 1 ? 's' : ''}
                    </div>
                    {skills.map((s, i) => (
                      <div key={i} style={{ marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                          <span style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>{s.skill}</span>
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: levelColor }}>{s.score}/100</span>
                        </div>
                        <div style={{ height: '6px', borderRadius: '999px', background: 'var(--bg-tertiary)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${s.score}%`, background: levelColor, borderRadius: '999px', transition: 'width 0.6s ease' }} />
                        </div>
                        {s.evidence && (
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem', fontStyle: 'italic' }}>{s.evidence}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          )}

          {/* ── Projects ── */}
          {result.projects?.length > 0 && (
            <div className="result-card">
              <h3>Projects ({result.projects.length})</h3>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem', marginTop: '0.5rem' }}>
                {result.projects.map((proj, i) => {
                  const complexityColor = proj.complexity === 'Complex' ? '#F59E0B' : proj.complexity === 'Medium' ? '#00F0FF' : '#22C55E'
                  return (
                    <div key={i} style={{
                      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
                      borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: 'var(--text-primary)' }}>{proj.name}</div>
                        {proj.complexity && (
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: complexityColor, border: `1px solid ${complexityColor}`, borderRadius: '999px', padding: '0.15rem 0.5rem', whiteSpace: 'nowrap' }}>
                            {proj.complexity}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>{proj.description}</p>
                      {proj.highlights?.length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: '1rem', fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                          {proj.highlights.map((h, hi) => <li key={hi}>{h}</li>)}
                        </ul>
                      )}
                      {proj.technologies?.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginTop: '0.25rem' }}>
                          {proj.technologies.map((t, ti) => (
                            <span key={ti} className="skill-tag tech" style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem' }}>{t}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── GitHub Languages Chart ── */}
          {result.github_analysis?.language_breakdown && Object.keys(result.github_analysis.language_breakdown).length > 0 && (
            <div className="result-card">
              <h3>GitHub Languages</h3>
              {result.github_analysis.frameworks_detected?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
                  {result.github_analysis.frameworks_detected.map((f, i) => (
                    <span key={i} className="skill-tag tech" style={{ fontSize: '0.75rem' }}>{f}</span>
                  ))}
                </div>
              )}
              <div style={{ height: '260px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={Object.entries(result.github_analysis.language_breakdown).map(([name, value]) => ({ name, value }))}
                      cx="50%" cy="50%"
                      innerRadius={55} outerRadius={80}
                      paddingAngle={4} dataKey="value"
                    >
                      {Object.entries(result.github_analysis.language_breakdown).map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} stroke="rgba(0,0,0,0)" />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ backgroundColor: '#1A1D24', border: '1px solid #2D3139', borderRadius: '8px' }} itemStyle={{ color: '#fff' }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* ── Strengths + Improvement Areas ── */}
          {(result.strengths?.length > 0 || result.improvement_areas?.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {result.strengths?.length > 0 && (
                <div className="result-card">
                  <h3 style={{ color: 'var(--accent-secondary)' }}>Strengths</h3>
                  <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-muted)', lineHeight: 1.9, margin: 0 }}>
                    {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {result.improvement_areas?.length > 0 && (
                <div className="result-card">
                  <h3 style={{ color: 'var(--accent-orange)' }}>Areas to Improve</h3>
                  <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-muted)', lineHeight: 1.9, margin: 0 }}>
                    {result.improvement_areas.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Education + Certifications ── */}
          {(result.education?.length > 0 || result.certifications?.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              {result.education?.length > 0 && (
                <div className="result-card">
                  <h3>Education</h3>
                  <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-muted)', lineHeight: 1.9, margin: 0 }}>
                    {result.education.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
              {result.certifications?.length > 0 && (
                <div className="result-card">
                  <h3 style={{ color: '#8B5CF6' }}>Certifications</h3>
                  <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-muted)', lineHeight: 1.9, margin: 0 }}>
                    {result.certifications.map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* ── Soft Skills ── */}
          {result.soft_skills?.length > 0 && (
            <div className="result-card">
              <h3>Soft Skills</h3>
              <div className="skills-cloud">
                {result.soft_skills.map((skill, i) => (
                  <span key={i} className="skill-tag soft">{skill}</span>
                ))}
              </div>
            </div>
          )}

          {/* ── Learned from Quests ── */}
          {result.quest_skills?.length > 0 && (
            <div className="result-card" style={{ borderLeft: '3px solid #22C55E' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                <h3 style={{ margin: 0, color: '#22C55E' }}>Learned from Quests</h3>
                <span style={{ fontSize: '0.72rem', background: 'rgba(34,197,94,0.12)', color: '#22C55E', border: '1px solid rgba(34,197,94,0.3)', borderRadius: '999px', padding: '0.15rem 0.55rem', fontWeight: 700 }}>
                  +{result.quest_skills.length} new
                </span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>These skills were verified through completed quests and have been added to your profile.</p>
              <div className="skills-cloud">
                {result.quest_skills.map((skill, i) => (
                  <span key={i} className="skill-tag" style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.35)', color: '#22C55E' }}>{skill}</span>
                ))}
              </div>
            </div>
          )}

          {/* ── All Technical Skills (fallback if no ratings) ── */}
          {(!result.skill_ratings || result.skill_ratings.length === 0) && result.technical_skills?.length > 0 && (
            <div className="result-card">
              <h3>Technical Skills</h3>
              <div className="skills-cloud">
                {result.technical_skills.map((skill, i) => (
                  <span key={i} className="skill-tag tech">{skill}</span>
                ))}
              </div>
            </div>
          )}

          <button
            className="analyze-btn"
            onClick={() => setResult(null)}
            style={{ marginTop: '1rem', background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}
          >
            Scan Another Profile
          </button>
        </div>
      )}
    </div>
  )
}

const Sidebar = ({ activeTab, setActiveTab, metrics }) => {
  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'profile-scan', label: 'Profile Scan', icon: ScanFace },
    { id: 'role-gap', label: 'Role Gap', icon: Target },
    { id: 'quest-map', label: 'Quest Map', icon: Map },
    { id: 'daily-quest', label: 'Eat the Frog', icon: Swords },
    { id: 'stats', label: 'Stats', icon: BarChart2 },
  ]

  // Progress toward NEXT community tier (500 / 1000 / 2500 / 5000)
  const TIERS = [500, 1000, 2500, 5000]
  const xp = metrics?.xp || 0
  const nextTier = TIERS.find(t => xp < t) || TIERS[TIERS.length - 1]
  const prevTier = TIERS[TIERS.indexOf(nextTier) - 1] || 0
  const xpProgress = Math.min(((xp - prevTier) / (nextTier - prevTier)) * 100, 100)

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-logo">
          <Zap size={28} fill="currentColor" />
        </div>
        <div>
          Career Coach
          <span className="brand-subtitle">CO-PILOT</span>
        </div>
      </div>

      <div className="menu-label">MENU</div>
      <nav className="nav-menu">
        {menuItems.map((item) => (
          <div
            key={item.id}
            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
          >
            <item.icon size={20} />
            {item.label}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="rank-card">
          <div className="rank-info">
            <span className="rank-title">Rank</span>
            <span className="rank-value text-gradient">{metrics?.rank || 'Unranked'}</span>
          </div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${xpProgress}%` }}></div>
          </div>
          <div className="rank-info" style={{ marginTop: '8px', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            <span>LVL {metrics?.level || 1}</span>
            <span>{xp}/{nextTier} XP</span>
          </div>
        </div>
      </div>
    </aside>
  )
}

const DashboardHeader = ({ metrics }) => {
  return (
    <header className="top-header">
      <div className="menu-trigger" style={{ display: 'none' }}>
        <Menu />
      </div>
      <div>
        {/* Breadcrumb or Title could go here */}
      </div>
      <div className="header-actions">
        <div className="fire-badge">
          <Flame size={16} fill="currentColor" />
          {metrics?.streak || 0}
        </div>
        <div className="xp-badge">
          <span style={{ fontSize: '0.8rem', fontWeight: 800 }}>XP</span>
          {metrics?.xp || 0} XP
        </div>
      </div>
    </header>
  )
}

const WelcomeSection = ({ metrics, userName, onSetName }) => {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(userName || '')
  const xpProgress = metrics ? (metrics.xp % 500) / 500 * 100 : 0

  const save = () => { if (draft.trim()) { onSetName(draft.trim()); setEditing(false) } }

  const hasNoProgress = !metrics?.learned_skills?.length && !metrics?.total_completed_tasks

  return (
    <>
    {hasNoProgress && (
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,240,255,0.08) 0%, rgba(34,197,94,0.06) 100%)',
        border: '1px solid rgba(0,240,255,0.25)', borderRadius: '16px',
        padding: '1.25rem 1.5rem', marginBottom: '1.5rem',
        display: 'flex', alignItems: 'flex-start', gap: '1rem'
      }}>
        <span style={{ fontSize: '2rem', flexShrink: 0 }}>🚀</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.3rem', color: 'var(--text-primary)' }}>Start here — 3 steps to get going</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            {[
              { step: '1', text: 'Scan your resume or GitHub to extract your skills', action: 'Profile Scan', tab: 'profile-scan' },
              { step: '2', text: 'Run a Role Gap analysis to see exactly what you\'re missing', action: 'Role Gap', tab: 'role-gap' },
              { step: '3', text: 'Complete Eat the Frog to earn XP and build verified skills', action: 'Eat the Frog', tab: 'daily-quest' },
            ].map(({ step, text }) => (
              <div key={step} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.83rem', color: 'var(--text-muted)' }}>
                <span style={{ background: 'rgba(0,240,255,0.15)', borderRadius: '999px', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent-primary)', flexShrink: 0 }}>{step}</span>
                {text}
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
    <section className="welcome-card">
      <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
        <div className="welcome-badge">
          <RankBadge rank={metrics?.rank} size={36} />
          <span style={{ fontSize: '0.7rem', marginTop: '0.25rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em' }}>
            {metrics?.rank || 'unranked'}
          </span>
        </div>

        <div className="welcome-content" style={{ flex: 1 }}>
          {editing ? (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
              <input
                autoFocus
                className="custom-input"
                style={{ height: '36px', fontSize: '1rem', maxWidth: '260px', padding: '0 0.75rem' }}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && save()}
                placeholder="Enter your name"
              />
              <button onClick={save} style={{ padding: '0.4rem 0.9rem', borderRadius: '8px', background: 'var(--accent-primary)', color: '#000', fontWeight: 700, border: 'none', cursor: 'pointer', fontSize: '0.85rem' }}>Save</button>
            </div>
          ) : (
            <h1 style={{ cursor: 'pointer' }} onClick={() => { setDraft(userName); setEditing(true) }}>
              Welcome, <span style={{ color: 'var(--accent-primary)' }}>{userName || 'Adventurer'}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: '0.5rem', fontWeight: 400 }}>✎</span>
            </h1>
          )}
          <p>Your career quest awaits. Complete quests to earn XP and level up.</p>

          <div className="level-info" title="Earn XP by completing Eat the Frog challenges, verifying skills, and finishing your roadmap steps. Every 500 XP = 1 level up.">
            <div className="level-text">
              <span>LVL {metrics?.level || 1} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>NEXT LEVEL</span></span>
              <span style={{ color: 'var(--text-muted)' }}>{metrics ? metrics.xp % 500 : 0}/500</span>
            </div>
            <div className="progress-bar" style={{ height: '8px', background: 'var(--bg-primary)' }}>
              <div
                className="progress-fill"
                style={{
                  width: `${xpProgress}%`,
                  background: 'linear-gradient(90deg, var(--accent-secondary) 0%, var(--accent-primary) 100%)',
                  boxShadow: '0 0 10px rgba(0, 240, 255, 0.3)'
                }}
              ></div>
            </div>
          </div>
        </div>

        <div className="streak-circle" style={{ marginLeft: '2rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <Flame size={24} fill="currentColor" />
            <span>{metrics?.streak || 0}</span>
          </div>
        </div>
      </div>
    </section>
    </>
  )
}

const StatsGrid = ({ metrics }) => {
  const stats = [
    {
      label: 'Quests Done',
      value: metrics ? `${metrics.total_completed_tasks}/${metrics.total_assigned_tasks}` : '0/0',
      subtext: 'Lifetime total',
      icon: Award,
      color: 'var(--accent-secondary)',
      trend: true
    },
    {
      label: 'Rank Tier',
      value: metrics?.rank || 'Unranked',
      subtext: 'Global standing',
      icon: Target,
      color: 'var(--accent-primary)',
      trend: true
    },
    {
      label: 'Day Streak',
      value: metrics ? `${metrics.streak} 🔥` : '0 🔥',
      subtext: 'Consistency',
      icon: Flame,
      color: 'var(--accent-orange)',
      trend: true
    },
    {
      label: 'Execution',
      value: metrics?.execution_score.toFixed(0) || 0,
      subtext: 'Accuracy score',
      icon: TrendingUp,
      color: '#8B5CF6',
      trend: true
    },
  ]

  return (
    <div className="stats-grid">
      {stats.map((stat, index) => (
        <div key={index} className="stat-card">
          <div className="trend-indicator">▲</div>
          <div className="stat-icon" style={{ color: stat.color, backgroundColor: `${stat.color}15` }}>
            <stat.icon size={20} />
          </div>
          <div className="stat-value">{stat.value}</div>
          <span className="stat-label">{stat.label}</span>
          <p className="stat-subtext">{stat.subtext}</p>
        </div>
      ))}
    </div>
  )
}

const ActionGrid = ({ setActiveTab }) => {
  return (
    <div className="action-grid">
      <div className="action-card" onClick={() => setActiveTab('daily-quest')} style={{ cursor: 'pointer' }}>
        <div className="action-left">
          <div className="action-icon-box" style={{ background: 'rgba(34, 197, 94, 0.1)', color: 'var(--accent-secondary)' }}>
            <Swords size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem' }}>Today's Challenge</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Tackle your hardest skill first · +5–20 XP</span>
          </div>
        </div>
        <ChevronRight size={20} color="var(--text-muted)" />
      </div>

      <div className="action-card" onClick={() => setActiveTab('profile-scan')} style={{ cursor: 'pointer' }}>
        <div className="action-left">
          <div className="action-icon-box" style={{ background: 'rgba(139, 92, 246, 0.1)', color: '#8B5CF6' }}>
            <ScanFace size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1rem' }}>Scan Profile</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Upload resume or GitHub to map your skills</span>
          </div>
        </div>
        <ChevronRight size={20} color="var(--text-muted)" />
      </div>
    </div>
  )
}

const CommunitiesSection = ({ metrics }) => {
  const currentXP = metrics?.xp || 0

  const communities = [
    {
      id: 'beginner',
      name: 'Beginner Community',
      threshold: 500,
      description: 'Start your journey with other builders.',
      tag: 'LEVEL 1+',
      color: 'var(--accent-secondary)',
      discord: 'https://discord.gg/WMjyddhq'
    },
    {
      id: 'intermediate',
      name: 'Intermediate Community',
      threshold: 1000,
      description: 'Step up to more advanced challenges.',
      tag: 'LEVEL 5+',
      color: 'var(--accent-primary)',
      discord: 'https://discord.gg/WMjyddhq'
    },
    {
      id: 'advanced',
      name: 'Advanced Community',
      threshold: 2500,
      description: 'Connect with seasoned professionals.',
      tag: 'LEVEL 10+',
      color: '#8B5CF6',
      discord: 'https://discord.gg/WMjyddhq'
    },
    {
      id: 'expert',
      name: 'Expert Community',
      threshold: 5000,
      description: 'Exclusive elite-only space.',
      tag: 'ELITE',
      color: 'gold',
      discord: 'https://discord.gg/WMjyddhq'
    }
  ]

  const joinCommunity = (comm) => {
    if (currentXP >= comm.threshold) {
      window.open(comm.discord, '_blank')
    }
  }

  const unlockedCount = communities.filter(c => currentXP >= c.threshold).length

  return (
    <div style={{ marginTop: '2.5rem' }}>
      <div className="section-title">
        <Users size={20} color="var(--accent-primary)" />
        <h3>Guilds & Communities</h3>
        <span style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {unlockedCount}/{communities.length} joined
        </span>
      </div>

      <div className="achievement-grid" style={{ marginBottom: '2rem' }}>
        {communities.map((comm) => {
          const isUnlocked = currentXP >= comm.threshold
          return (
            <div
              key={comm.id}
              className={`achievement-card ${isUnlocked ? 'unlocked' : ''}`}
              onClick={() => joinCommunity(comm)}
              style={{
                borderColor: isUnlocked ? comm.color : 'var(--border-color)',
                opacity: isUnlocked ? 1 : 0.4,
                position: 'relative',
                cursor: isUnlocked ? 'pointer' : 'default',
                transition: 'all 0.3s ease'
              }}
            >
              <div className="achievement-icon" style={{
                background: isUnlocked ? `${comm.color}15` : 'var(--bg-primary)',
                color: isUnlocked ? comm.color : 'var(--text-muted)'
              }}>
                <Users size={20} />
              </div>
              <div className="achievement-info">
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <h4 style={{ color: isUnlocked ? 'var(--text-primary)' : 'var(--text-muted)' }}>{comm.name}</h4>
                  <span className="achievement-tag" style={{
                    color: isUnlocked ? comm.color : 'inherit',
                    borderColor: isUnlocked ? comm.color : 'transparent'
                  }}>
                    {comm.tag}
                  </span>
                </div>
                <p className="achievement-desc">
                  {isUnlocked ? comm.description : `Unlock at ${comm.threshold} XP`}
                </p>
              </div>
              {isUnlocked ? (
                <ExternalLink size={14} style={{ position: 'absolute', top: '1rem', right: '1rem', color: comm.color }} />
              ) : (
                <Lock size={14} style={{ position: 'absolute', top: '1rem', right: '1rem', color: 'var(--text-muted)' }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const RoleGap = ({ userSkills, userAddedSkills = [], onAddSkill, onRemoveSkill, gapResult, setGapResult, selectedRole, setSelectedRole, marketStats, setMarketStats }) => {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [skillInput, setSkillInput] = useState('')

  const handleAddSkill = () => {
    const trimmed = skillInput.trim()
    if (trimmed && onAddSkill) {
      onAddSkill(trimmed)
      setSkillInput('')
    }
  }
  const [impactResult, setImpactResult] = useState(null)
  const [marketRefreshing, setMarketRefreshing] = useState(false)
  const [marketError, setMarketError] = useState(null)

  const handleMarketRefresh = async () => {
    setMarketRefreshing(true)
    setMarketError(null)
    try {
      const data = await refreshMarketData()
      const stats = { ...data, refreshed_at: new Date().toISOString() }
      if (setMarketStats) setMarketStats(stats)
    } catch (e) {
      setMarketError('Refresh failed: ' + (e.message || 'Unknown error'))
    } finally {
      setMarketRefreshing(false)
    }
  }

  const roles = [
    "Frontend Developer",
    "Backend Developer",
    "Full Stack Developer",
    "Data Analyst",
    "Data Scientist",
    "Machine Learning Engineer",
    "DevOps Engineer",
    "Cloud Engineer",
    "Mobile Developer",
    "AI/ML Research Engineer",
    "Site Reliability Engineer",
    "Product Manager",
  ]

  const handleAnalyze = async () => {
    if (!selectedRole) return

    setLoading(true)
    setError(null)
    setImpactResult(null)
    const allSkills = [...new Set([...userSkills])]
    try {
      const response = await fetch(`${BASE_URL}/analyze-role`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_skills: allSkills,
          selected_role: selectedRole,
          user_id: 'user_1'
        })
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setGapResult(data)

      // Fire skill impact in background — doesn't block the gap result
      getSkillImpact({ user_skills: allSkills, target_role: selectedRole, user_id: 'user_1' })
        .then(setImpactResult)
        .catch(() => {}) // silent — impact scores are bonus data
    } catch (e) {
      console.error(e)
      setError(e.message || 'Gap analysis failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="scan-container">
      <div className="scan-header">
        <div className="scan-title">
          <Target size={32} color="var(--accent-secondary)" />
          <h2>Role Gap Analysis</h2>
        </div>
        <p className="scan-subtitle">Compare your skills against your target role using live job market data.</p>
      </div>

      {/* ── Live Market Data Sources Banner ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap',
        padding: '0.85rem 1.1rem', marginBottom: '1.5rem',
        background: 'rgba(0,240,255,0.04)', borderRadius: '10px',
        border: '1px solid rgba(0,240,255,0.12)'
      }}>
        <TrendingUp size={15} color="var(--accent-primary)" style={{ flexShrink: 0 }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em' }}>LIVE DATA SOURCES</span>
        {[
          { label: 'RemoteOK', count: marketStats?.sources?.remoteok, color: '#22C55E' },
          { label: 'Indeed / LinkedIn', count: marketStats?.sources?.jsearch, color: '#00F0FF' },
          { label: 'Adzuna', count: marketStats?.sources?.adzuna, color: '#F59E0B' },
        ].filter(src => src.count == null || src.count > 0).map(src => (
          <span key={src.label} style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
            padding: '0.2rem 0.6rem', borderRadius: '999px',
            background: `${src.color}18`, border: `1px solid ${src.color}44`,
            fontSize: '0.72rem', fontWeight: 700, color: src.color
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: src.color, display: 'inline-block' }} />
            {src.label}{src.count != null ? `: ${src.count} jobs` : ''}
          </span>
        ))}
        {marketStats?.refreshed_at && (
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            Last synced: {new Date(marketStats.refreshed_at).toLocaleTimeString()}
          </span>
        )}
        {marketStats?.total_jobs_processed != null && (
          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-secondary)' }}>
            {marketStats.total_jobs_processed} jobs analysed
          </span>
        )}
        <button
          onClick={handleMarketRefresh}
          disabled={marketRefreshing}
          style={{
            marginLeft: marketStats ? '0' : 'auto',
            padding: '0.3rem 0.8rem', borderRadius: '6px', fontSize: '0.72rem', fontWeight: 700,
            border: '1px solid var(--accent-primary)', background: 'transparent',
            color: 'var(--accent-primary)', cursor: marketRefreshing ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: marketRefreshing ? 0.6 : 1,
            transition: 'background 0.2s'
          }}
        >
          {marketRefreshing ? <Sparkles className="spin" size={12} /> : <TrendingUp size={12} />}
          {marketRefreshing ? 'Syncing...' : 'Sync Now'}
        </button>
        {marketError && <span style={{ fontSize: '0.7rem', color: 'var(--accent-orange)' }}>⚠ {marketError}</span>}
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <select
          className="custom-input"
          style={{ height: '50px', fontSize: '1rem', cursor: 'pointer' }}
          value={selectedRole}
          onChange={(e) => setSelectedRole(e.target.value)}
        >
          <option value="">Select target role</option>
          {roles.map(r => <option key={r} value={r}>{r}</option>)}
        </select>

        {error && (
          <p style={{ color: 'var(--accent-orange)', marginTop: '0.5rem', fontSize: '0.9rem' }}>⚠ {error}</p>
        )}

        {/* ── No-skills hint ── */}
        {userSkills.length === 0 && userAddedSkills.length === 0 && (
          <div style={{
            marginTop: '1rem', padding: '0.85rem 1rem', borderRadius: '10px',
            background: 'rgba(251,146,60,0.07)', border: '1px solid rgba(251,146,60,0.25)',
            fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.6rem'
          }}>
            <span style={{ fontSize: '1.1rem' }}>💡</span>
            <span>No skills found yet. <strong style={{ color: 'var(--accent-primary)' }}>Go to Profile Scan first</strong> to auto-extract your skills from your resume or GitHub — then come back here for a full gap analysis.</span>
          </div>
        )}

        {/* ── Manually Add Skills ── */}
        <div style={{ marginTop: '1.25rem' }}>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: '0.6rem' }}>
            Add Your Skills Manually
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <input
              className="custom-input"
              style={{ flex: 1, height: '42px', padding: '0 0.9rem', fontSize: '0.9rem' }}
              placeholder="e.g. FastAPI, Redis, Terraform…"
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddSkill() } }}
            />
            <button
              onClick={handleAddSkill}
              disabled={!skillInput.trim()}
              style={{
                height: '42px', padding: '0 1rem', borderRadius: '8px', fontWeight: 700, fontSize: '0.88rem',
                border: '1px solid var(--accent-primary)', background: 'rgba(0,240,255,0.08)',
                color: 'var(--accent-primary)', cursor: skillInput.trim() ? 'pointer' : 'not-allowed',
                opacity: skillInput.trim() ? 1 : 0.4, transition: 'all 0.2s',
              }}
            >+ Add</button>
          </div>
          {userAddedSkills.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
              {userAddedSkills.map(s => (
                <span key={s} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.2rem 0.7rem', borderRadius: '999px', fontSize: '0.8rem',
                  background: 'rgba(0,240,255,0.08)', border: '1px solid rgba(0,240,255,0.25)',
                  color: 'var(--accent-primary)',
                }}>
                  {s}
                  <span
                    onClick={() => onRemoveSkill && onRemoveSkill(s)}
                    style={{ cursor: 'pointer', opacity: 0.6, fontWeight: 700, lineHeight: 1 }}
                  >×</span>
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          className="analyze-btn"
          style={{ marginTop: '1rem', backgroundColor: selectedRole ? 'var(--accent-secondary)' : 'var(--bg-tertiary)', color: selectedRole ? 'var(--bg-primary)' : 'var(--text-muted)' }}
          onClick={handleAnalyze}
          disabled={!selectedRole || loading}
        >
          {loading ? <Sparkles className="spin" size={20} /> : <Target size={20} />}
          {loading ? "Analyzing..." : "Analyze Gap"}
        </button>
      </div>

      {gapResult && (
        <div className="results-container">
          <div className="result-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1.5rem' }}>
            <div style={{ flex: 1 }}>
              <span className="stat-label">Role Alignment Score</span>
              <div style={{ fontSize: '3.2rem', fontWeight: 800, color: gapResult.alignment_score > 70 ? 'var(--accent-secondary)' : gapResult.alignment_score > 40 ? 'var(--accent-orange)' : '#EF4444', lineHeight: 1 }}>
                {gapResult.alignment_score}%
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                {gapResult.alignment_score > 70 ? '🟢 Strong match — ready to apply' : gapResult.alignment_score > 40 ? '🟡 Moderate — close a few gaps first' : '🔴 Significant skill gaps remaining'}
              </div>
            </div>
            <div style={{ position: 'relative', width: '110px', height: '110px', flexShrink: 0 }}>
              <svg width="110" height="110" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="55" cy="55" r="44" fill="none" stroke="var(--bg-tertiary)" strokeWidth="10" />
                <circle
                  cx="55" cy="55" r="44"
                  fill="none"
                  stroke={gapResult.alignment_score > 70 ? 'var(--accent-secondary)' : gapResult.alignment_score > 40 ? 'var(--accent-orange)' : '#EF4444'}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 44}`}
                  strokeDashoffset={`${2 * Math.PI * 44 * (1 - gapResult.alignment_score / 100)}`}
                  style={{ transition: 'stroke-dashoffset 0.8s ease' }}
                />
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{gapResult.alignment_score}%</span>
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>match</span>
              </div>
            </div>
          </div>

          {gapResult.missing_skills.length > 0 && (
            <div className="result-card">
              <h3>Priority Skills to Learn</h3>
              <div style={{ width: '100%', height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    layout="vertical"
                    data={gapResult.missing_skills.slice(0, 5)}
                    margin={{ top: 20, right: 30, left: 40, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#2D3139" />
                    <XAxis type="number" stroke="#6B7280" hide />
                    <YAxis
                      dataKey="skill"
                      type="category"
                      stroke="#9CA3AF"
                      width={100}
                      tick={{ fill: '#9CA3AF', fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1A1D24', border: '1px solid #2D3139', borderRadius: '8px' }}
                      itemStyle={{ color: '#fff' }}
                      cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                    />
                    <Bar dataKey="importance" fill="#F59E0B" radius={[0, 4, 4, 0]} name="Impact" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="result-card">
              <h3>Missing Skills</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {gapResult.missing_skills.length === 0 ? (
                <p style={{ color: 'var(--text-muted)' }}>No missing skills found! You are a perfect match.</p>
              ) : (
                gapResult.missing_skills.map((item, i) => {
                  const maxImportance = Math.max(...gapResult.missing_skills.map(s => s.importance), 1)
                  const barPct = Math.round((item.importance / maxImportance) * 100)
                  const iTop = i === 0
                  const isLearned = userAddedSkills.some(s => s.toLowerCase() === item.skill.toLowerCase())
                  return (
                    <div key={i} style={{
                      padding: '0.9rem 1rem',
                      background: isLearned ? 'rgba(34,197,94,0.05)' : iTop ? 'rgba(245,158,11,0.06)' : 'var(--bg-primary)',
                      borderRadius: '10px',
                      border: isLearned ? '1px solid rgba(34,197,94,0.3)' : iTop ? '1px solid rgba(245,158,11,0.25)' : '1px solid var(--border-color)',
                      opacity: isLearned ? 0.8 : 1,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                          {isLearned && (
                            <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#22C55E', border: '1px solid rgba(34,197,94,0.4)', borderRadius: '999px', padding: '0.1rem 0.5rem', textTransform: 'uppercase' }}>
                              ✓ Learned
                            </span>
                          )}
                          {!isLearned && iTop && <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#F59E0B', border: '1px solid #F59E0B', borderRadius: '999px', padding: '0.1rem 0.45rem', textTransform: 'uppercase' }}>Top Priority</span>}
                          <div style={{ fontWeight: 700, color: isLearned ? '#22C55E' : 'var(--text-primary)', fontSize: '0.95rem', textDecoration: isLearned ? 'line-through' : 'none' }}>{item.skill}</div>
                        </div>
                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: isLearned ? '#22C55E' : 'var(--accent-orange)', background: isLearned ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)', padding: '0.2rem 0.55rem', borderRadius: '6px' }}>
                          {isLearned ? 'Done' : `Impact ${item.importance}`}
                        </div>
                      </div>
                      <div style={{ height: '4px', background: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden', marginBottom: '0.45rem' }}>
                        <div style={{ height: '100%', width: `${isLearned ? 100 : barPct}%`, background: isLearned ? '#22C55E' : iTop ? '#F59E0B' : 'var(--accent-primary)', borderRadius: '999px', transition: 'width 0.6s ease' }} />
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{item.why_this_skill_matters}</div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* ── Market Impact Scores (loaded async) ── */}
          {impactResult ? (
            <div className="result-card fade-in">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <Cpu size={18} color="var(--accent-primary)" />
                <h3 style={{ margin: 0 }}>Market Impact Scores</h3>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                  demand × mastery × relevance
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                {impactResult.ranked_skills?.slice(0, 8).map((item, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{
                      minWidth: '20px', fontSize: '0.7rem', fontWeight: 700,
                      color: i === 0 ? 'var(--accent-primary)' : 'var(--text-muted)',
                      textAlign: 'right'
                    }}>#{item.priority_rank}</span>
                    <span style={{ flex: 1, fontWeight: 500, fontSize: '0.9rem' }}>{item.skill}</span>
                    <div style={{ width: '120px', height: '4px', background: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${item.impact_score}%`,
                        background: 'linear-gradient(90deg, var(--accent-secondary), var(--accent-primary))',
                        borderRadius: '2px',
                      }} />
                    </div>
                    <span style={{ minWidth: '32px', textAlign: 'right', fontWeight: 700, fontSize: '0.85rem', color: 'var(--accent-orange)' }}>
                      {item.impact_score?.toFixed(0)}
                    </span>
                  </div>
                ))}
              </div>
              {impactResult.top_priority && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'rgba(0,240,255,0.05)', borderRadius: '8px', border: '1px solid rgba(0,240,255,0.15)' }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>TOP PRIORITY → </span>
                  <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{impactResult.top_priority}</span>
                </div>
              )}
            </div>
          ) : gapResult && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <Sparkles className="spin" size={16} />
              Computing market impact scores...
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const RESOURCE_META = {
  youtube:  { icon: '▶', label: 'YouTube',  color: '#FF0000', bg: 'rgba(255,0,0,0.08)' },
  docs:     { icon: '📄', label: 'Docs',     color: '#00F0FF', bg: 'rgba(0,240,255,0.08)' },
  article:  { icon: '📝', label: 'Article',  color: '#F59E0B', bg: 'rgba(245,158,11,0.08)' },
  practice: { icon: '💻', label: 'Practice', color: '#22C55E', bg: 'rgba(34,197,94,0.08)' },
  course:   { icon: '🎓', label: 'Course',   color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)' },
}

const QuestMap = ({ gapResult, userSkills, selectedRole, masteryData, userId, fetchMetrics, onRoadmapComplete }) => {
  const [loading, setLoading] = useState(false)
  const [roadmap, setRoadmap] = useState(null)
  const [error, setError] = useState(null)
  const [expandedPhase, setExpandedPhase] = useState(0)
  const [hintLevels, setHintLevels] = useState({}) // { phaseIdx: 0|1|2|3 }
  const [expandedTasks, setExpandedTasks] = useState({}) // { phaseIdx: bool }
  const [roadmapCompleted, setRoadmapCompleted] = useState(false)
  const [completionData, setCompletionData] = useState(null) // { total_xp, skills }

  // Submission state per phase: { phaseIdx: { url, submitting, result, error } }
  const [submissions, setSubmissions] = useState({})
  // Completed phases (populated from roadmap data on load)
  const [completedPhases, setCompletedPhases] = useState({}) // { phaseIdx: bool }

  const _uid = userId || 'user_1'
  const autoGenTriggered = useRef(false) // prevent re-triggering auto-generate

  // Load persisted roadmap on mount
  useEffect(() => {
    getPersistedRoadmap(_uid)
      .then(r => {
        if (r?.status === 'generating') {
          // Generation in progress — start polling
          setLoading(true)
          const pollOnMount = async () => {
            let polls = 0
            const poll = async () => {
              polls++
              try {
                const result = await getPersistedRoadmap(_uid)
                if (result?.status === 'ready' && result?.phases?.length) {
                  setRoadmap(result)
                  const done = {}
                  result.phases.forEach((p, i) => { if (p.completed) done[i] = true })
                  setCompletedPhases(done)
                  if (result.phases.length > 0 && result.phases.every(p => p.completed)) {
                    setRoadmapCompleted(true)
                  }
                  setLoading(false)
                  return
                }
                if (result?.status === 'failed') {
                  setError(result.error || 'Roadmap generation failed.')
                  setLoading(false)
                  return
                }
              } catch (_) {}
              if (polls < 60) setTimeout(poll, 4000)
              else { setLoading(false) }
            }
            setTimeout(poll, 2000)
          }
          pollOnMount()
        } else if (r?.phases) {
          setRoadmap(r)
          // Restore completed state from persisted data
          const done = {}
          r.phases.forEach((p, i) => { if (p.completed) done[i] = true })
          setCompletedPhases(done)
          // Check if already fully completed
          if (r.phases.length > 0 && r.phases.every(p => p.completed)) {
            setRoadmapCompleted(true)
          }
        }
      })
      .catch(() => {})
      .finally(() => setPersistChecked(true))
  }, [_uid])

  const handleGenerate = async () => {
    if (!gapResult || !selectedRole) return
    setLoading(true)
    setError(null)
    try {
      // Build mastery_levels from masteryData
      const masteryLevels = {}
      if (masteryData?.mastery_levels) {
        masteryData.mastery_levels.forEach(m => { masteryLevels[m.skill] = m.level })
      }
      const missingSkills = (gapResult.missing_skills || gapResult.ranked_skills || [])
        .map(s => ({ skill: s.skill, importance: s.importance ?? s.impact_score ?? 0.5 }))

      // Kick off async generation (returns immediately)
      await generateDynamicRoadmap({
        user_id: userId || 'user_1',
        user_skills: userSkills || [],
        target_role: selectedRole,
        missing_skills: missingSkills,
        mastery_levels: masteryLevels,
      })

      // Poll for completion
      const POLL_INTERVAL = 4000 // 4 seconds
      const MAX_POLLS = 60      // up to ~4 minutes
      let polls = 0
      const poll = async () => {
        polls++
        try {
          const result = await getPersistedRoadmap(_uid)
          if (result?.status === 'ready' && result?.phases?.length) {
            setRoadmap(result)
            setExpandedPhase(0)
            setHintLevels({})
            setCompletedPhases({})
            setSubmissions({})
            setRoadmapCompleted(false)
            setCompletionData(null)
            setLoading(false)
            return
          }
          if (result?.status === 'failed') {
            setError(result.error || 'Roadmap generation failed. Please try again.')
            setLoading(false)
            return
          }
        } catch (_) { /* ignore poll errors, keep trying */ }
        if (polls < MAX_POLLS) {
          setTimeout(poll, POLL_INTERVAL)
        } else {
          setError('Roadmap generation is taking longer than expected. Please refresh the page in a minute.')
          setLoading(false)
        }
      }
      // Start polling after a short delay to let Lambda spin up
      setTimeout(poll, 3000)
    } catch (err) {
      setError(err.message || 'Failed to generate roadmap. Please try again.')
      setLoading(false)
    }
  }

  // Auto-generate roadmap when gapResult arrives and we have no existing roadmap
  // (e.g. right after onboarding completes)
  const [persistChecked, setPersistChecked] = useState(false)
  useEffect(() => {
    if (!persistChecked || autoGenTriggered.current || loading || roadmap) return
    if (gapResult && selectedRole) {
      autoGenTriggered.current = true
      handleGenerate()
    }
  }, [gapResult, selectedRole, persistChecked]) // eslint-disable-line react-hooks/exhaustive-deps

  const setSubmissionField = (phaseIdx, fields) => {
    setSubmissions(prev => ({ ...prev, [phaseIdx]: { ...(prev[phaseIdx] || {}), ...fields } }))
  }

  const handleSubmitProject = async (phaseIdx) => {
    const url = (submissions[phaseIdx]?.url || '').trim()
    if (!url) return
    setSubmissionField(phaseIdx, { submitting: true, result: null, error: null })
    try {
      const result = await submitPhaseProject(_uid, phaseIdx, url)
      setSubmissionField(phaseIdx, { submitting: false, result })
      // Mark phase complete in local state immediately
      const newCompleted = { ...completedPhases, [phaseIdx]: true }
      setCompletedPhases(newCompleted)
      // Refresh XP / level on dashboard + stats
      if (fetchMetrics) fetchMetrics()
      // Handle roadmap completion
      if (result.roadmap_complete) {
        setRoadmapCompleted(true)
        setCompletionData({
          bonus_xp: result.bonus_xp || 500,
          skills: result.newly_learned_skills || [],
        })
        if (onRoadmapComplete) onRoadmapComplete(result.newly_learned_skills || [])
      }
    } catch (err) {
      setSubmissionField(phaseIdx, { submitting: false, error: err.message || 'Evaluation failed. Please try again.' })
    }
  }

  const revealHint = (phaseIdx, level) => {
    setHintLevels(prev => ({ ...prev, [phaseIdx]: level }))
  }

  const DIFFICULTY_COLORS = { beginner: '#22C55E', intermediate: '#F59E0B', advanced: '#EF4444' }
  const RESOURCE_ICONS = { documentation: '📄', course_module: '🎓', video: '▶', github_example: '', article: '📝' }
  const RESOURCE_COLORS = { documentation: '#00F0FF', course_module: '#8B5CF6', video: '#FF0000', github_example: '#fff', article: '#F59E0B' }

  if (!gapResult && !roadmap) {
    return (
      <div className="scan-container">
        <div className="scan-header">
          <div className="scan-title">
            <Map size={32} color="var(--accent-primary)" />
            <h2>Quest Map</h2>
          </div>
          <p className="scan-subtitle">Complete the Role Gap Analysis first to unlock your personalized roadmap.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="scan-container">
      {/* ── Header ── */}
      <div className="scan-header">
        <div className="scan-title">
          <Map size={32} color="var(--accent-primary)" />
          <h2>Quest Map</h2>
        </div>
        <p className="scan-subtitle">
          A personalized multi-phase roadmap built by 5 AI agents — unique projects, calibrated daily challenges, and exact learning resources.
        </p>
      </div>

      {/* ── Agent Banner ── */}
      {roadmap?.agent_summary && (
        <div style={{
          display: 'flex', gap: '0.6rem', alignItems: 'flex-start',
          padding: '0.85rem 1.1rem', marginBottom: '1.25rem',
          background: 'rgba(139,92,246,0.07)', borderRadius: '10px',
          border: '1px solid rgba(139,92,246,0.2)',
        }}>
          <Sparkles size={14} color="#8B5CF6" style={{ flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: '0.78rem', color: '#8B5CF6', lineHeight: 1.6 }}>{roadmap.agent_summary}</span>
        </div>
      )}

      {/* ── Generate / Regenerate ── */}
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button className="analyze-btn" onClick={handleGenerate} disabled={loading} style={{ maxWidth: 280 }}>
          {loading ? <Sparkles className="spin" size={18} /> : <Sparkles size={18} />}
          {loading ? 'AI Agents Working…' : roadmap ? 'Regenerate Roadmap' : 'Generate My Roadmap'}
        </button>
        {loading && (
          <span style={{ fontSize: '0.78rem', color: '#8B5CF6', animation: 'pulse 2s infinite' }}>
            ATLAS · FORGE · QUEST · SAGE agents are crafting your roadmap…
          </span>
        )}
        {roadmap && !loading && (
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Generated {roadmap.generated_at ? new Date(roadmap.generated_at).toLocaleDateString() : ''} · {roadmap.total_phases} phases for {roadmap.target_role}
          </span>
        )}
      </div>

      {error && <p style={{ color: 'var(--accent-orange)', marginBottom: '1rem', fontSize: '0.9rem' }}>⚠ {error}</p>}

      {/* ── Roadmap Completion Banner ── */}
      {roadmapCompleted && (
        <div style={{
          borderRadius: '14px', padding: '1.5rem 1.75rem', marginBottom: '1.5rem',
          background: 'linear-gradient(135deg, rgba(34,197,94,0.12) 0%, rgba(0,240,255,0.08) 100%)',
          border: '1px solid rgba(34,197,94,0.4)',
          boxShadow: '0 0 32px rgba(34,197,94,0.12)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <Trophy size={22} color="#22C55E" />
            <span style={{ fontSize: '1.1rem', fontWeight: 800, color: '#22C55E' }}>ROADMAP COMPLETE 🎉</span>
            {completionData?.bonus_xp > 0 && (
              <span style={{
                fontSize: '0.78rem', fontWeight: 800, color: 'var(--accent-primary)',
                background: 'rgba(0,240,255,0.12)', border: '1px solid rgba(0,240,255,0.3)',
                padding: '0.2rem 0.7rem', borderRadius: '999px',
              }}>+{completionData.bonus_xp} BONUS XP</span>
            )}
          </div>
          <p style={{ margin: '0 0 0.85rem', fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
            You've submitted every phase project. Your XP, level, and skill profile have been updated.
            <br /><strong style={{ color: 'var(--accent-primary)' }}>Auto-advancing to your next skill challenge in a moment…</strong>
          </p>
          {completionData?.skills?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: '#22C55E', alignSelf: 'center' }}>SKILLS UNLOCKED:</span>
              {[...new Set(completionData.skills)].map(s => (
                <span key={s} style={{
                  fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.65rem',
                  borderRadius: '999px', background: 'rgba(34,197,94,0.12)',
                  border: '1px solid rgba(34,197,94,0.3)', color: '#22C55E',
                }}>{s}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="result-card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <Sparkles className="spin" size={36} color="var(--accent-primary)" style={{ margin: '0 auto 1rem' }} />
          <h3 style={{ marginBottom: '0.5rem' }}>5 Agents Collaborating…</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', maxWidth: 440, margin: '0 auto' }}>
            ATLAS is structuring phases · FORGE is crafting unique projects · QUEST is calibrating your daily challenge · SAGE is curating exact resources
          </p>
        </div>
      )}

      {/* ── Phases ── */}
      {roadmap?.phases && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {roadmap.phases.map((phase, phIdx) => {
            const isOpen = expandedPhase === phIdx
            const isCompleted = completedPhases[phIdx] || phase.completed
            const diffColor = isCompleted ? '#22C55E' : (DIFFICULTY_COLORS[phase.difficulty] || '#00F0FF')
            const hintLevel = hintLevels[phIdx] || 0
            const tasksOpen = expandedTasks[phIdx] ?? true
            const sub = submissions[phIdx] || {}
            const evalResult = sub.result || (phase.evaluation ? { ...phase.evaluation, _fromCache: true } : null)

            return (
              <div key={phIdx} className="result-card" style={{
                borderLeft: `4px solid ${diffColor}`,
                transition: 'box-shadow 0.2s, border-color 0.3s',
                boxShadow: isOpen ? `0 0 0 1px ${diffColor}30` : 'none',
                background: isCompleted ? 'rgba(34,197,94,0.03)' : undefined,
              }}>
                {/* Phase header — click to expand/collapse */}
                <div
                  onClick={() => setExpandedPhase(isOpen ? -1 : phIdx)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: '1rem' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: '0.65rem', fontWeight: 800, letterSpacing: '0.1em',
                      color: diffColor, background: `${diffColor}18`, border: `1px solid ${diffColor}40`,
                      padding: '0.2rem 0.6rem', borderRadius: '999px',
                    }}>PHASE {phase.phase}</span>
                    <h3 style={{ margin: 0, fontSize: '1.05rem' }}>{phase.focus_skill}</h3>
                    {isCompleted ? (
                      <span style={{
                        fontSize: '0.67rem', fontWeight: 800, color: '#22C55E',
                        background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)',
                        padding: '0.15rem 0.6rem', borderRadius: '999px', letterSpacing: '0.06em',
                      }}>✓ COMPLETED</span>
                    ) : (
                      <span style={{
                        fontSize: '0.65rem', fontWeight: 700, color: diffColor, textTransform: 'uppercase',
                        background: `${diffColor}12`, padding: '0.15rem 0.5rem', borderRadius: '6px',
                      }}>{phase.difficulty}</span>
                    )}
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {Math.round(phase.importance * 100)}% demand
                    </span>
                    {evalResult && (
                      <span style={{
                        fontSize: '0.67rem', fontWeight: 700,
                        color: evalResult.passed ? '#22C55E' : '#F59E0B',
                      }}>
                        {evalResult.passed ? `+${evalResult.xp_awarded} XP` : `Score: ${evalResult.score}/100`}
                      </span>
                    )}
                  </div>
                  <ChevronRight size={18} color="var(--text-muted)" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }} />
                </div>

                {isOpen && (
                  <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

                    {/* ── Learning Tasks ── */}
                    <div>
                      <div
                        onClick={() => setExpandedTasks(p => ({ ...p, [phIdx]: !tasksOpen }))}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: tasksOpen ? '0.75rem' : 0 }}
                      >
                        <BookOpen size={15} color="var(--accent-primary)" />
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>7-DAY LEARNING PLAN</span>
                        <ChevronRight size={13} color="var(--text-muted)" style={{ transform: tasksOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                      </div>
                      {tasksOpen && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                          {(phase.learning_tasks || []).map((task, ti) => (
                            <div key={ti} style={{
                              display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                              padding: '0.55rem 0.75rem', borderRadius: '8px',
                              background: 'rgba(255,255,255,0.025)',
                              border: '1px solid rgba(255,255,255,0.04)',
                            }}>
                              <div style={{
                                minWidth: 22, height: 22, borderRadius: '50%',
                                background: `${diffColor}20`, border: `1.5px solid ${diffColor}50`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.65rem', fontWeight: 700, color: diffColor, flexShrink: 0,
                              }}>
                                {ti + 1}
                              </div>
                              <span style={{ fontSize: '0.88rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{task}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── Portfolio Project (FORGE) ── */}
                    {phase.project && (
                      <div style={{
                        borderRadius: '12px', overflow: 'hidden',
                        border: '1px solid rgba(139,92,246,0.25)',
                        background: 'rgba(139,92,246,0.04)',
                      }}>
                        <div style={{ padding: '1rem 1.1rem 0.75rem', borderBottom: '1px solid rgba(139,92,246,0.15)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            <Trophy size={15} color="#8B5CF6" />
                            <span style={{ fontSize: '0.65rem', fontWeight: 800, color: '#8B5CF6', letterSpacing: '0.1em' }}>PORTFOLIO PROJECT · FORGE</span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                              ~{phase.project.estimated_hours}h · {phase.project.archetype}
                            </span>
                          </div>
                          <h4 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>{phase.project.title}</h4>
                          <p style={{ margin: '0.4rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{phase.project.description}</p>
                        </div>

                        <div style={{ padding: '0.85rem 1.1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                          {/* Objectives */}
                          {phase.project.objectives?.length > 0 && (
                            <div>
                              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>OBJECTIVES</div>
                              <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                {phase.project.objectives.map((obj, i) => (
                                  <li key={i} style={{ fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{obj}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* Deliverables */}
                          {phase.project.deliverables?.length > 0 && (
                            <div>
                              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>DELIVERABLES</div>
                              <ul style={{ margin: 0, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                                {phase.project.deliverables.map((d, i) => (
                                  <li key={i} style={{ fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{d}</li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {/* 3-Level Progressive Hint System */}
                          {phase.project.hints && (
                            <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: '10px', padding: '0.85rem 1rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                                <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#F59E0B', letterSpacing: '0.08em' }}>💡 HINT SYSTEM</span>
                                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>· Reveal progressively — avoid spoiling your own learning</span>
                              </div>
                              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: hintLevel > 0 ? '0.75rem' : 0, flexWrap: 'wrap' }}>
                                {[
                                  { lv: 1, label: 'Concept', color: '#22C55E' },
                                  { lv: 2, label: 'Implementation', color: '#F59E0B' },
                                  { lv: 3, label: 'Architecture', color: '#EF4444' },
                                  { lv: 4, label: 'Debugging', color: '#8B5CF6' },
                                ].map(({ lv, label, color }) => (
                                  <button
                                    key={lv}
                                    onClick={() => revealHint(phIdx, hintLevel >= lv ? lv - 1 : lv)}
                                    style={{
                                      fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                                      padding: '0.25rem 0.75rem', borderRadius: '999px',
                                      border: `1px solid ${hintLevel >= lv ? color : 'rgba(255,255,255,0.12)'}`,
                                      background: hintLevel >= lv ? `${color}20` : 'transparent',
                                      color: hintLevel >= lv ? color : 'var(--text-muted)',
                                      transition: 'all 0.15s',
                                    }}
                                  >
                                    {hintLevel >= lv ? `▼ ${label}` : `▶ ${label}`}
                                  </button>
                                ))}
                              </div>
                              {hintLevel >= 1 && (
                                <div style={{ padding: '0.6rem 0.8rem', borderRadius: '8px', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', marginBottom: '0.4rem' }}>
                                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#22C55E', marginBottom: '0.25rem' }}>CONCEPT</div>
                                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>{phase.project.hints.level_1}</p>
                                </div>
                              )}
                              {hintLevel >= 2 && (
                                <div style={{ padding: '0.6rem 0.8rem', borderRadius: '8px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', marginBottom: '0.4rem' }}>
                                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#F59E0B', marginBottom: '0.25rem' }}>IMPLEMENTATION</div>
                                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>{phase.project.hints.level_2}</p>
                                </div>
                              )}
                              {hintLevel >= 3 && (
                                <div style={{ padding: '0.6rem 0.8rem', borderRadius: '8px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: '0.4rem' }}>
                                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#EF4444', marginBottom: '0.25rem' }}>ARCHITECTURE</div>
                                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>{phase.project.hints.level_3}</p>
                                </div>
                              )}
                              {hintLevel >= 4 && phase.project.hints.level_4 && (
                                <div style={{ padding: '0.6rem 0.8rem', borderRadius: '8px', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}>
                                  <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#8B5CF6', marginBottom: '0.25rem' }}>DEBUGGING</div>
                                  <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-primary)', lineHeight: 1.6 }}>{phase.project.hints.level_4}</p>
                                </div>
                              )}
                            </div>
                          )}

                          {/* ── Submit for REVIEW ── */}
                          <div style={{ borderTop: '1px solid rgba(139,92,246,0.15)', paddingTop: '1rem' }}>
                            {isCompleted && evalResult ? (
                              /* Result panel */
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                                  <span style={{
                                    fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.08em',
                                    color: evalResult.passed ? '#22C55E' : '#F59E0B',
                                  }}>
                                    {evalResult.passed ? '✓ PROJECT PASSED — REVIEW' : '⚠ NEEDS IMPROVEMENT — REVIEW'}
                                  </span>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
                                  <div style={{ textAlign: 'center', padding: '0.65rem 1.1rem', borderRadius: '10px', background: `${evalResult.passed ? '#22C55E' : '#F59E0B'}15`, border: `1px solid ${evalResult.passed ? '#22C55E' : '#F59E0B'}30` }}>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: evalResult.passed ? '#22C55E' : '#F59E0B' }}>{evalResult.score}</div>
                                    <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>Score / 100</div>
                                  </div>
                                  {evalResult.xp_awarded > 0 && (
                                    <div style={{ textAlign: 'center', padding: '0.65rem 1.1rem', borderRadius: '10px', background: 'rgba(0,240,255,0.08)', border: '1px solid rgba(0,240,255,0.2)' }}>
                                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--accent-primary)' }}>+{evalResult.xp_awarded}</div>
                                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>XP Earned</div>
                                    </div>
                                  )}
                                </div>
                                {evalResult.feedback && (
                                  <p style={{ fontSize: '0.83rem', color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 0.65rem' }}>{evalResult.feedback}</p>
                                )}
                                {evalResult.skill_evidence?.length > 0 && (
                                  <div style={{ marginBottom: '0.5rem' }}>
                                    <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#22C55E', marginBottom: '0.3rem' }}>EVIDENCE FOUND</div>
                                    <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                                      {evalResult.skill_evidence.map((e, i) => <li key={i} style={{ fontSize: '0.78rem', color: 'var(--text-primary)', lineHeight: 1.5 }}>{e}</li>)}
                                    </ul>
                                  </div>
                                )}
                                {evalResult.missing?.length > 0 && (
                                  <div style={{ marginBottom: '0.5rem' }}>
                                    <div style={{ fontSize: '0.67rem', fontWeight: 700, color: '#F59E0B', marginBottom: '0.3rem' }}>TO IMPROVE</div>
                                    <ul style={{ margin: 0, paddingLeft: '1.2rem' }}>
                                      {evalResult.missing.map((m, i) => <li key={i} style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{m}</li>)}
                                    </ul>
                                  </div>
                                )}
                                <button
                                  onClick={() => setSubmissionField(phIdx, { url: '', result: null })}
                                  style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)', background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', padding: '0.3rem 0.75rem', cursor: 'pointer' }}
                                >
                                  Resubmit
                                </button>
                              </div>
                            ) : (
                              /* Input form */
                              <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.6rem' }}>
                                  <Github size={13} color="#8B5CF6" />
                                  <span style={{ fontSize: '0.68rem', fontWeight: 800, color: '#8B5CF6', letterSpacing: '0.08em' }}>SUBMIT FOR REVIEW</span>
                                  <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>— paste your GitHub repo URL</span>
                                </div>
                                <div style={{ display: 'flex', gap: '0.65rem', flexWrap: 'wrap' }}>
                                  <input
                                    type="url"
                                    value={sub.url || ''}
                                    onChange={e => setSubmissionField(phIdx, { url: e.target.value })}
                                    placeholder="https://github.com/you/your-project"
                                    disabled={sub.submitting}
                                    onKeyDown={e => e.key === 'Enter' && handleSubmitProject(phIdx)}
                                    style={{
                                      flex: 1, minWidth: 220, padding: '0.55rem 0.85rem',
                                      borderRadius: '8px', fontSize: '0.85rem',
                                      background: 'var(--bg-tertiary)', border: '1px solid rgba(139,92,246,0.3)',
                                      color: 'var(--text-primary)', outline: 'none',
                                    }}
                                  />
                                  <button
                                    onClick={() => handleSubmitProject(phIdx)}
                                    disabled={!sub.url?.trim() || sub.submitting}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: '0.4rem',
                                      padding: '0.55rem 1.1rem', borderRadius: '8px', cursor: 'pointer',
                                      background: sub.submitting ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.18)',
                                      border: '1px solid rgba(139,92,246,0.45)',
                                      color: '#8B5CF6', fontWeight: 700, fontSize: '0.82rem',
                                      opacity: !sub.url?.trim() ? 0.5 : 1,
                                    }}
                                  >
                                    {sub.submitting ? <Sparkles className="spin" size={14} /> : <Trophy size={14} />}
                                    {sub.submitting ? 'Evaluating…' : 'Submit & Evaluate'}
                                  </button>
                                </div>
                                {sub.error && (
                                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: 'var(--accent-orange)' }}>⚠ {sub.error}</p>
                                )}
                                {sub.submitting && (
                                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.78rem', color: '#8B5CF6' }}>
                                    REVIEW agent is analysing your repository…
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* ── Resources (SAGE) ── */}
                    {phase.resources?.length > 0 && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.65rem' }}>
                          <ExternalLink size={13} color="var(--accent-secondary)" />
                          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>EXACT LEARNING RESOURCES · SAGE</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                          {phase.resources.map((r, ri) => {
                            const rColor = RESOURCE_COLORS[r.type] || '#F59E0B'
                            const rIcon = RESOURCE_ICONS[r.type] || '📝'
                            return (
                              <a
                                key={ri}
                                href={r.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'flex', gap: '0.75rem', alignItems: 'flex-start',
                                  padding: '0.75rem 0.9rem', borderRadius: '10px',
                                  background: `${rColor}0A`, border: `1px solid ${rColor}25`,
                                  textDecoration: 'none', transition: 'border-color 0.15s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = `${rColor}55`}
                                onMouseLeave={e => e.currentTarget.style.borderColor = `${rColor}25`}
                              >
                                <span style={{ fontSize: '1rem', flexShrink: 0 }}>{rIcon}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.15rem', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>{r.title}</span>
                                    {r.time_to_consume && (
                                      <span style={{ fontSize: '0.65rem', color: rColor, background: `${rColor}15`, padding: '0.1rem 0.4rem', borderRadius: '999px', fontWeight: 600 }}>
                                        {r.time_to_consume}
                                      </span>
                                    )}
                                  </div>
                                  <p style={{ margin: 0, fontSize: '0.77rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{r.description}</p>
                                  <div style={{ fontSize: '0.68rem', color: rColor, marginTop: '0.2rem', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {r.url}
                                  </div>
                                </div>
                                <ExternalLink size={12} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: 2 }} />
                              </a>
                            )
                          })}
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Empty state ── */}
      {!roadmap && !loading && (
        <div className="result-card" style={{ textAlign: 'center', padding: '4rem 2rem' }}>
          <div style={{
            width: '80px', height: '80px', background: 'var(--bg-tertiary)',
            borderRadius: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1.5rem',
          }}>
            <Map size={40} color="var(--accent-primary)" />
          </div>
          <h3 style={{ marginBottom: '0.5rem' }}>Generate Your Personalized Roadmap</h3>
          <p style={{ color: 'var(--text-muted)', maxWidth: 440, margin: '0 auto 2rem', fontSize: '0.9rem', lineHeight: 1.6 }}>
            5 AI agents will collaborate to build you a unique, phase-by-phase plan — complete with portfolio projects, progressive hints, daily challenges, and exact resources for:&nbsp;
            <strong style={{ color: 'var(--text-primary)' }}>
              {(gapResult.missing_skills || gapResult.ranked_skills || []).slice(0, 3).map(s => s.skill).join(', ')}
            </strong>
          </p>
          <button className="analyze-btn" onClick={handleGenerate} disabled={loading} style={{ maxWidth: 300, margin: '0 auto' }}>
            <Sparkles size={18} />
            Generate My Roadmap
          </button>
        </div>
      )}
    </div>
  )
}

const DailyQuest = ({ onComplete, selectedRole, allUserSkills, nextPrioritySkill }) => {
  const SKILL_OPTIONS = [
    'System Design', 'Python', 'JavaScript', 'React', 'Docker',
    'Kubernetes', 'SQL', 'Data Structures', 'Algorithms', 'AWS',
    'Machine Learning', 'TypeScript', 'Node.js', 'Git',
  ]

  const TYPE_META = {
    quiz:            { label: 'Quiz',            icon: '🧠', color: '#8B5CF6' },
    code_completion: { label: 'Code Completion', icon: '⌨️',  color: '#00F0FF' },
    debugging:       { label: 'Debug Task',      icon: '🐛', color: '#F59E0B' },
    micro_impl:      { label: 'Mini Build',      icon: '⚙️',  color: '#22C55E' },
    concept_explain: { label: 'Explain It',      icon: '💬', color: '#EC4899' },
  }

  const [selectedSkill, setSelectedSkill] = useState(nextPrioritySkill || '')
  const [challenge, setChallenge]         = useState(null)
  const [submission, setSubmission]       = useState('')
  const [selectedOption, setSelectedOption] = useState(null)
  const [unlockedHints, setUnlockedHints] = useState([])
  const [loading, setLoading]             = useState(false)
  const [fetchingChallenge, setFetchingChallenge] = useState(false)
  const [error, setError]                 = useState(null)
  const [result, setResult]               = useState(null)

  const handleFetchChallenge = async () => {
    if (!selectedSkill) return
    setFetchingChallenge(true)
    setError(null)
    setUnlockedHints([])
    setSelectedOption(null)
    setSubmission('')
    try {
      const data = await getDailyChallenge('user_1', selectedSkill)
      setChallenge(data)
    } catch (err) {
      setError(err.message || 'Failed to generate challenge.')
    } finally {
      setFetchingChallenge(false)
    }
  }

  const handleAutoChallenge = async () => {
    setFetchingChallenge(true)
    setError(null)
    setUnlockedHints([])
    setSelectedOption(null)
    setSubmission('')
    try {
      const data = await getDailyChallenge('user_1', null, false)
      setSelectedSkill(data.skill_targeted || '')
      setChallenge(data)
    } catch (err) {
      setError(err.message || 'Failed to generate challenge.')
    } finally {
      setFetchingChallenge(false)
    }
  }

  const handleSubmit = async () => {
    const answer = challenge?.challenge_type === 'quiz' ? selectedOption : submission
    if (!answer) return
    setLoading(true)
    setError(null)
    try {
      const data = await evaluateDailyChallenge('user_1', challenge, answer)
      setResult(data)
      if (onComplete) onComplete()
    } catch (err) {
      setError(err.message || 'Submission failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setChallenge(null)
    setResult(null)
    setSubmission('')
    setSelectedOption(null)
    setUnlockedHints([])
    setSelectedSkill('')
    setError(null)
  }

  const unlockHint = (idx) => {
    if (!unlockedHints.includes(idx)) setUnlockedHints(prev => [...prev, idx])
  }

  const diffColor = { beginner: '#22C55E', intermediate: '#F59E0B', advanced: '#EF4444' }
  const typeMeta = challenge ? (TYPE_META[challenge.challenge_type] || { label: challenge.challenge_type, icon: '🎯', color: 'var(--accent-primary)' }) : null

  return (
    <div className="scan-container">
      <div className="scan-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="scan-title">
            <Swords size={32} color="var(--accent-primary)" />
            <h2>Today's Quest</h2>
          </div>
          <p className="scan-subtitle">AI-personalised micro-challenges that sharpen your skills and close gaps. Do your hardest task first.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ color: 'var(--accent-orange)', fontWeight: 700 }}>+5–20 XP</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>per quest</div>
        </div>
      </div>

      {/* ── Result Screen ── */}
      {result ? (
        <div className="results-container fade-in">
          <div className="result-card" style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{
              width: '64px', height: '64px',
              background: result.passed ? 'rgba(34,197,94,0.1)' : 'rgba(251,146,60,0.1)',
              borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 1rem auto',
            }}>
              <Trophy size={32} color={result.passed ? 'var(--accent-secondary)' : 'var(--accent-orange)'} />
            </div>
            <h3 style={{ color: result.passed ? 'var(--accent-secondary)' : 'var(--accent-orange)', marginBottom: '0.4rem' }}>
              {result.passed ? 'Quest Complete!' : 'Keep Practising!'}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
              {result.feedback}
            </p>

            {/* Mastery delta */}
            {result.mastery_after !== undefined && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.75rem',
                background: 'rgba(0,240,255,0.06)', border: '1px solid rgba(0,240,255,0.2)',
                borderRadius: '12px', padding: '0.6rem 1.1rem', marginBottom: '1.25rem',
              }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Mastery</span>
                <span style={{ fontWeight: 800, color: 'var(--text-primary)' }}>{result.mastery_before}/4</span>
                <span style={{ color: 'var(--text-muted)' }}>→</span>
                <span style={{
                  fontWeight: 800,
                  color: result.mastery_after > result.mastery_before ? 'var(--accent-secondary)'
                       : result.mastery_after < result.mastery_before ? 'var(--accent-orange)'
                       : 'var(--text-primary)',
                }}>
                  {result.mastery_after}/4
                  {result.mastery_after > result.mastery_before ? ' ↑' : result.mastery_after < result.mastery_before ? ' ↓' : ''}
                </span>
                {result.gap_updated && (
                  <span style={{ fontSize: '0.7rem', color: result.score >= 70 ? 'var(--accent-secondary)' : 'var(--accent-orange)', fontWeight: 700 }}>
                    {result.score >= 70 ? '• Gap shrinking' : '• Gap widening'}
                  </span>
                )}
              </div>
            )}

            <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
              <div className="stat-card">
                <span className="stat-label">Score</span>
                <div className="stat-value" style={{ color: result.score >= 70 ? 'var(--accent-secondary)' : 'var(--accent-orange)' }}>
                  {result.score}/100
                </div>
              </div>
              <div className="stat-card">
                <span className="stat-label">XP Earned</span>
                <div className="stat-value" style={{ color: 'var(--accent-primary)' }}>+{result.xp_earned}</div>
              </div>
              <div className="stat-card">
                <span className="stat-label">Streak</span>
                <div className="stat-value">{result.streak}🔥</div>
              </div>
            </div>
          </div>

          {/* Strengths */}
          {result.strengths?.length > 0 && (
            <div className="result-card">
              <h3 style={{ color: 'var(--accent-secondary)', marginBottom: '0.75rem' }}>✅ Strengths</h3>
              <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-muted)', lineHeight: '1.8', margin: 0 }}>
                {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}

          {/* Mistakes */}
          {result.mistakes?.length > 0 && (
            <div className="result-card">
              <h3 style={{ color: 'var(--accent-orange)', marginBottom: '0.75rem' }}>⚠ Mistakes to Address</h3>
              <ul style={{ paddingLeft: '1.2rem', color: 'var(--text-muted)', lineHeight: '1.8', margin: 0 }}>
                {result.mistakes.map((m, i) => <li key={i}>{m}</li>)}
              </ul>
            </div>
          )}

          {/* Ideal answer */}
          {result.correct_answer && (
            <div className="result-card">
              <h3 style={{ color: 'var(--accent-primary)', marginBottom: '0.75rem' }}>💡 Model Answer</h3>
              <p style={{ color: 'var(--text-muted)', lineHeight: '1.7', margin: 0, whiteSpace: 'pre-wrap' }}>{result.correct_answer}</p>
            </div>
          )}

          <button className="analyze-btn" onClick={handleReset} style={{ marginTop: '1rem' }}>
            <Swords size={20} /> New Quest
          </button>
        </div>

      ) : !challenge ? (
        /* ── Skill Selection Screen ── */
        <div className="result-card fade-in" style={{ textAlign: 'center', padding: '2.5rem 2rem' }}>
          <div style={{
            width: '80px', height: '80px', background: 'var(--bg-tertiary)',
            borderRadius: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1.5rem auto', boxShadow: '0 0 20px rgba(0,240,255,0.1)',
          }}>
            <Swords size={40} color="var(--accent-primary)" />
          </div>
          <h3 style={{ fontSize: '1.4rem', marginBottom: '0.5rem' }}>Choose Your Challenge</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
            Pick a skill or let the AI coach choose for you based on your gaps.
          </p>

          {/* Auto-challenge CTA */}
          <button
            className="analyze-btn"
            onClick={handleAutoChallenge}
            disabled={fetchingChallenge}
            style={{
              maxWidth: '320px',
              margin: '0 auto 1.5rem auto',
              background: fetchingChallenge
                ? 'rgba(0,240,255,0.1)'
                : 'linear-gradient(135deg, #00f0ff 0%, #8b5cf6 100%)',
              border: 'none',
              color: '#000',
              fontWeight: 700,
              boxShadow: fetchingChallenge ? 'none' : '0 0 24px rgba(0,240,255,0.45)',
            }}
          >
            {fetchingChallenge ? <Sparkles className="spin" size={20} /> : <Zap size={20} />}
            {fetchingChallenge ? 'Generating…' : '⚡ AI Pick My Challenge'}
          </button>

          <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginBottom: '1rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>— or choose a skill —</div>

          {/* Recommended skill */}
          {nextPrioritySkill && (
            <div
              onClick={() => setSelectedSkill(nextPrioritySkill)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.6rem',
                padding: '0.6rem 1.1rem', borderRadius: '12px', cursor: 'pointer',
                marginBottom: '1.25rem',
                border: `2px solid ${selectedSkill === nextPrioritySkill ? 'var(--accent-primary)' : 'rgba(0,240,255,0.3)'}`,
                background: selectedSkill === nextPrioritySkill ? 'rgba(0,240,255,0.1)' : 'rgba(0,240,255,0.04)',
              }}
            >
              <span>🎯</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: '0.65rem', color: 'var(--accent-primary)', fontWeight: 700, textTransform: 'uppercase' }}>Priority Gap</div>
                <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>{nextPrioritySkill}</div>
              </div>
              {selectedSkill === nextPrioritySkill && <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>✓</span>}
            </div>
          )}

          <div className="skills-cloud" style={{ justifyContent: 'center', marginBottom: '1.75rem' }}>
            {SKILL_OPTIONS.map(sk => (
              <span
                key={sk} className="skill-tag tech"
                onClick={() => setSelectedSkill(sk)}
                style={{
                  cursor: 'pointer',
                  border: selectedSkill === sk ? '1px solid var(--accent-primary)' : '1px solid transparent',
                  background: selectedSkill === sk ? 'rgba(0,240,255,0.1)' : undefined,
                  color: selectedSkill === sk ? 'var(--accent-primary)' : undefined,
                }}
              >{sk}</span>
            ))}
          </div>

          {error && <p style={{ color: 'var(--accent-orange)', marginBottom: '1rem', fontSize: '0.9rem' }}>⚠ {error}</p>}

          <button
            className="analyze-btn"
            onClick={handleFetchChallenge}
            disabled={!selectedSkill || fetchingChallenge}
            style={{ maxWidth: '300px', margin: '0 auto', opacity: !selectedSkill ? 0.5 : 1 }}
          >
            {fetchingChallenge ? <Sparkles className="spin" size={20} /> : <Zap size={20} />}
            {fetchingChallenge ? 'Generating Challenge…' : 'Get Challenge'}
          </button>
        </div>

      ) : (
        /* ── Active Challenge Screen ── */
        <div className="result-card fade-in">
          {/* Header badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 700,
              background: `${typeMeta.color}18`, border: `1px solid ${typeMeta.color}44`, color: typeMeta.color,
            }}>
              {typeMeta.icon} {typeMeta.label}
            </span>
            <span style={{
              padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.72rem', fontWeight: 700,
              background: `${diffColor[challenge.difficulty_level] || '#888'}18`,
              border: `1px solid ${diffColor[challenge.difficulty_level] || '#888'}44`,
              color: diffColor[challenge.difficulty_level] || '#888',
            }}>
              {challenge.difficulty_level}
            </span>
            <span className="skill-tag tech" style={{ border: '1px solid var(--accent-primary)', color: 'var(--accent-primary)' }}>
              {challenge.skill_targeted}
            </span>
            {challenge.is_gap_skill && (
              <span style={{
                padding: '0.25rem 0.75rem', borderRadius: '999px', fontSize: '0.7rem', fontWeight: 700,
                background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#EF4444',
              }}>🔴 Gap Skill</span>
            )}
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              +{challenge.xp_available} XP
            </span>
          </div>

          {/* Challenge prompt */}
          <h3 style={{ fontSize: '1rem', lineHeight: '1.7', marginBottom: '1.25rem', color: 'var(--text-primary)', whiteSpace: 'pre-wrap' }}>
            {challenge.challenge_prompt}
          </h3>

          {/* Context code */}
          {challenge.context_code && (
            <pre style={{
              background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)',
              borderRadius: '10px', padding: '1rem', overflowX: 'auto',
              fontSize: '0.82rem', lineHeight: '1.6', color: '#A5F3FC', marginBottom: '1.25rem',
            }}>{challenge.context_code}</pre>
          )}

          {/* Quiz options */}
          {challenge.challenge_type === 'quiz' && challenge.options && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.25rem' }}>
              {Object.entries(challenge.options).map(([key, val]) => (
                <div
                  key={key}
                  onClick={() => setSelectedOption(key)}
                  style={{
                    padding: '0.75rem 1rem', borderRadius: '10px', cursor: 'pointer',
                    border: `1px solid ${selectedOption === key ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                    background: selectedOption === key ? 'rgba(0,240,255,0.08)' : 'var(--bg-secondary)',
                    color: selectedOption === key ? 'var(--accent-primary)' : 'var(--text-primary)',
                    display: 'flex', alignItems: 'center', gap: '0.75rem', transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontWeight: 800, minWidth: '1.2rem' }}>{key}</span>
                  <span style={{ fontSize: '0.9rem' }}>{val}</span>
                </div>
              ))}
            </div>
          )}

          {/* Text answer (non-quiz) */}
          {challenge.challenge_type !== 'quiz' && (
            <textarea
              className="custom-input"
              style={{ height: '180px', padding: '1rem', resize: 'vertical', marginBottom: '1rem', fontFamily: 'monospace', fontSize: '0.87rem' }}
              placeholder={
                challenge.challenge_type === 'debugging' ? 'Describe the bug and paste your fixed code…' :
                challenge.challenge_type === 'micro_impl' ? 'Write your implementation here…' :
                challenge.challenge_type === 'code_completion' ? 'Paste the completed code snippet…' :
                'Explain the concept in your own words…'
              }
              value={submission}
              onChange={e => setSubmission(e.target.value)}
            />
          )}

          {/* Expected answer format hint */}
          {challenge.expected_answer_format && (
            <div style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginBottom: '1rem', fontStyle: 'italic' }}>
              Expected format: {challenge.expected_answer_format}
            </div>
          )}

          {/* Hints */}
          {challenge.hints?.length > 0 && (
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                Hints ({unlockedHints.length}/{challenge.hints.length} unlocked)
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {challenge.hints.map((hint, idx) => (
                  <div key={idx} style={{ flex: '1 1 250px' }}>
                    {unlockedHints.includes(idx) ? (
                      <div style={{
                        padding: '0.6rem 0.85rem', borderRadius: '8px', fontSize: '0.82rem',
                        background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)',
                        color: 'var(--text-primary)', lineHeight: '1.5',
                      }}>
                        💡 {hint}
                      </div>
                    ) : (
                      <button
                        onClick={() => unlockHint(idx)}
                        style={{
                          width: '100%', padding: '0.5rem 0.85rem', borderRadius: '8px', fontSize: '0.78rem',
                          border: '1px dashed rgba(139,92,246,0.4)', background: 'transparent',
                          color: '#8B5CF6', cursor: 'pointer', fontWeight: 600,
                        }}
                      >
                        🔒 Unlock Hint {idx + 1}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && <p style={{ color: 'var(--accent-orange)', marginBottom: '1rem', fontSize: '0.9rem' }}>⚠ {error}</p>}

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button
              className="analyze-btn"
              onClick={handleSubmit}
              disabled={loading || (challenge.challenge_type === 'quiz' ? !selectedOption : submission.length < 15)}
              style={{ flex: 1 }}
            >
              {loading ? <Sparkles className="spin" size={20} /> : <Zap size={20} />}
              {loading ? 'Evaluating…' : 'Submit Answer'}
            </button>
            <button
              onClick={() => { setChallenge(null); setSubmission(''); setSelectedOption(null); setUnlockedHints([]); }}
              style={{
                padding: '0 1.25rem', borderRadius: '12px', border: '1px solid var(--border-color)',
                background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem',
              }}
            >
              Change
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const Gauge = ({ value, displayValue, label, color, size = 180 }) => {
  const radius = size * 0.45
  const stroke = size * 0.07
  const normalizedRadius = radius - stroke
  const circumference = normalizedRadius * 2 * Math.PI
  const strokeDashoffset = circumference - (value / 100) * circumference

  return (
    <div className="gauge-outer" style={{ width: size, textAlign: 'center' }}>
      <div className="gauge-container" style={{ width: size, height: size, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg height={size} width={size} style={{ transform: 'rotate(-90deg)', position: 'absolute' }}>
          <circle
            stroke="var(--bg-tertiary)"
            fill="transparent"
            strokeWidth={stroke}
            r={normalizedRadius}
            cx={size / 2}
            cy={size / 2}
          />
          <circle
            stroke={color}
            fill="transparent"
            strokeWidth={stroke}
            strokeDasharray={circumference + ' ' + circumference}
            style={{ strokeDashoffset, transition: 'stroke-dashoffset 0.5s ease' }}
            strokeLinecap="round"
            r={normalizedRadius}
            cx={size / 2}
            cy={size / 2}
          />
        </svg>
        <div className="gauge-value" style={{ fontSize: `${size * 0.16}px`, fontWeight: 800, color: 'var(--text-primary)' }}>{displayValue || value}</div>
      </div>
      <div className="gauge-label" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '12px' }}>{label}</div>
    </div>
  )
}

const PlayerStats = ({ metrics, selectedRole, scanResult, masteryData, userName }) => {
  if (!metrics) return <div className="loading-state"><Sparkles className="spin" /></div>

  const TIERS = [500, 1000, 2500, 5000]
  const xp = metrics.xp
  const nextTier = TIERS.find(t => xp < t) || TIERS[TIERS.length - 1]
  const prevTier = TIERS[TIERS.indexOf(nextTier) - 1] || 0
  const xpProgress = Math.min(((xp - prevTier) / (nextTier - prevTier)) * 100, 100)

  // Build skill proficiency from real data: mastery tracker or skill_distribution from DynamoDB
  const scannedSkills = scanResult?.technical_skills || []

  // Normalise raw skill_xp values to a 0-100 percentage relative to the top skill
  const normalisedSkillDist = (() => {
    if (!metrics.skill_distribution || Object.keys(metrics.skill_distribution).length === 0) return {}
    const entries = Object.entries(metrics.skill_distribution)
    const maxVal = Math.max(...entries.map(([, v]) => v), 1)
    return Object.fromEntries(entries.map(([k, v]) => [k, Math.round((v / maxVal) * 100)]))
  })()

  const skillProfData = (() => {
    // Prefer normalised skill_distribution from DynamoDB
    if (Object.keys(normalisedSkillDist).length > 0) {
      return Object.entries(normalisedSkillDist)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
        .map(([name, value]) => ({ name, value }))
    }
    // Fallback: use mastery data if available
    if (masteryData && Object.keys(masteryData).length > 0) {
      return Object.entries(masteryData)
        .slice(0, 8)
        .map(([name, info]) => ({ name, value: info?.score || 0 }))
    }
    // Fallback: use scanned skills with position-based placeholder scores
    if (scannedSkills.length > 0) {
      return scannedSkills.slice(0, 8).map((skill, i) => ({
        name: skill,
        value: Math.max(30, Math.round(80 - i * 7))
      }))
    }
    return []
  })()

  return (
    <div className="scan-container">
      <div className="scan-header">
        <div className="scan-title">
          <BarChart2 size={32} color="var(--accent-primary)" />
          <h2>Player Stats</h2>
        </div>
        <p className="scan-subtitle">Track your progress and climb the ranks.</p>
      </div>

      <div className="result-card career-warrior-card">
        <div className="warrior-badge">
          <RankBadge rank={metrics.rank} size={44} />
          <div className="warrior-rank-num">{metrics.level}</div>
        </div>
        <div style={{ flex: 1 }}>
          <h3 className="warrior-name">{userName || 'Career Warrior'}</h3>
          <p className="warrior-track">{metrics.rank || 'Unranked'} · {selectedRole || 'Developer'} Track</p>

          <div className="level-info" style={{ marginTop: '1.5rem' }}>
            <div className="level-text">
              <span>LVL {metrics.level} <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>→ {nextTier} XP</span></span>
              <span style={{ color: 'var(--text-muted)' }}>{xp}/{nextTier}</span>
            </div>
            <div className="progress-bar" style={{ height: '8px', background: 'var(--bg-primary)' }}>
              <div
                className="progress-fill"
                style={{
                  width: `${xpProgress}%`,
                  background: 'linear-gradient(90deg, var(--accent-secondary) 0%, var(--accent-primary) 100%)',
                  boxShadow: '0 0 10px rgba(0, 240, 255, 0.3)'
                }}
              ></div>
            </div>
          </div>

          <div className="warrior-stats-row">
            <span><Swords size={14} /> {metrics.total_completed_tasks} quests</span>
            <span><Flame size={14} /> {metrics.streak} streak</span>
            <span><Zap size={14} /> {metrics.execution_score.toFixed(0)} exec</span>
          </div>
        </div>
      </div>

      {/* ── Mastery Tracker (from Agentic Intelligence Loop) ── */}
      {masteryData?.mastery_levels?.length > 0 && (
        <div className="result-card" style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>
              Skill Mastery Levels
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '0.6rem' }}>computed by Mastery Tracker</span>
            </h3>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{masteryData.mastery_levels.length} skills</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
            {masteryData.mastery_levels.map(item => (
              <div key={item.skill} style={{ display: 'flex', alignItems: 'center', gap: '0.9rem' }}>
                <span style={{
                  minWidth: '110px', maxWidth: '130px', fontSize: '0.85rem', fontWeight: 600,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: 'var(--text-primary)',
                }}>{item.skill}</span>
                <div style={{ flex: 1, height: '7px', background: 'var(--bg-tertiary)', borderRadius: '999px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${(item.level / 4) * 100}%`,
                    background: MASTERY_COLORS[item.level] || 'var(--accent-primary)',
                    borderRadius: '999px',
                    transition: 'width 0.6s ease',
                  }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '110px', justifyContent: 'flex-end' }}>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700,
                    color: MASTERY_COLORS[item.level] || 'var(--accent-primary)',
                  }}>{item.level_name}</span>
                  {item.skill_xp > 0 && (
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '0.1rem 0.4rem', borderRadius: '999px' }}>
                      {item.skill_xp} XP
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="charts-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="result-card" style={{ height: '360px' }}>
          <h3>Knowledge Map</h3>
          {metrics.knowledge_map?.some(e => e.value > 0) ? (
            <ResponsiveContainer width="100%" height="85%">
              <PieChart>
                <Pie
                  data={metrics.knowledge_map}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {metrics.knowledge_map.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
                <Legend verticalAlign="bottom" height={36} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: '85%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '0.5rem' }}>
              <BarChart2 size={32} strokeWidth={1} />
              <span style={{ fontSize: '0.85rem' }}>Complete quests to populate your knowledge map</span>
            </div>
          )}
        </div>

        <div className="result-card" style={{ height: '360px' }}>
          <h3>Skill Proficiency {scannedSkills.length > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--accent-secondary)', fontWeight: 400, marginLeft: '0.5rem' }}>from profile scan</span>}</h3>
          <ResponsiveContainer width="100%" height="85%">
            <BarChart data={skillProfData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-color)" />
              <XAxis type="number" domain={[0, 100]} hide />
              <YAxis dataKey="name" type="category" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} width={90} />
              <Tooltip
                cursor={{ fill: 'rgba(255,255,255,0.05)' }}
                contentStyle={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px' }}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                {skillProfData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={index % 2 === 0 ? 'var(--accent-primary)' : 'var(--accent-secondary)'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="result-card" style={{ height: '360px' }}>
          <h3>Skill Distribution</h3>
          {Object.keys(normalisedSkillDist).length > 0 ? (
            <ResponsiveContainer width="100%" height="85%">
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={Object.entries(normalisedSkillDist).map(([name, value]) => ({ subject: name, A: value, fullMark: 100 }))}>
                <PolarGrid stroke="var(--border-color)" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-muted)', fontSize: 12 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <Radar name="Skills" dataKey="A" stroke="var(--accent-primary)" fill="var(--accent-primary)" fillOpacity={0.3} />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: '85%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '0.5rem' }}>
              <BarChart2 size={32} strokeWidth={1} />
              <span style={{ fontSize: '0.85rem' }}>Submit quests to build your skill distribution</span>
            </div>
          )}
        </div>

        <div className="result-card" style={{ height: '360px' }}>
          <h3>Activity Curve</h3>
          {metrics.activity_log?.length > 0 ? (
            <ResponsiveContainer width="100%" height="85%">
              <AreaChart data={metrics.activity_log} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorXp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent-secondary)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="var(--accent-secondary)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" stroke="var(--text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis hide />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-color)" />
                <Tooltip contentStyle={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', borderRadius: '8px' }} itemStyle={{ color: 'var(--accent-secondary)' }} />
                <Area type="monotone" dataKey="xp" stroke="var(--accent-secondary)" fillOpacity={1} fill="url(#colorXp)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: '85%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', gap: '0.5rem' }}>
              <Zap size={32} strokeWidth={1} />
              <span style={{ fontSize: '0.85rem' }}>Your activity history will appear here as you complete quests</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Performance Gauges ── */}
      <div className="result-card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1.5rem' }}>Performance Overview</h3>
        <div className="gauges-wrapper" style={{ background: 'transparent', border: 'none', padding: '0.5rem 0', marginTop: 0, flexWrap: 'wrap', gap: '1.5rem' }}>
          <Gauge
            value={Math.round(metrics.total_completed_tasks / (metrics.total_assigned_tasks || 1) * 100)}
            label="Quest Completion"
            color="var(--accent-primary)"
            size={160}
          />
          <Gauge
            value={Math.min(100, Math.round(metrics.execution_score ?? 0))}
            label="Execution Score"
            color="#8B5CF6"
            size={160}
          />
          <Gauge
            value={Math.round(xpProgress)}
            displayValue={`${nextTier - xp} XP`}
            label="XP To Next LVL"
            color="#F59E0B"
            size={160}
          />
          <Gauge
            value={Math.min(100, Math.round((metrics.streak / 30) * 100))}
            displayValue={`${metrics.streak}d`}
            label="Current Streak"
            color="#10B981"
            size={160}
          />
        </div>
      </div>

      {/* ── Full Stats Breakdown ── */}
      <div className="result-card" style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ marginBottom: '1.2rem' }}>Full Player Statistics</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
          {[
            { icon: '⚡', label: 'Total XP',            value: `${metrics.xp} XP` },
            { icon: '🏅', label: 'Level',               value: `Level ${metrics.level}` },
            { icon: '🎖️', label: 'Rank',                value: metrics.rank || 'Unranked' },
            { icon: '🎯', label: 'Next Priority Skill',  value: metrics.next_priority_skill || '—' },
            { icon: '✅', label: 'Quests Completed',     value: `${metrics.total_completed_tasks} / ${metrics.total_assigned_tasks}` },
            { icon: '🔥', label: 'Day Streak',           value: `${metrics.streak} day${metrics.streak !== 1 ? 's' : ''}` },
            { icon: '📈', label: 'Execution Score',      value: `${(metrics.execution_score ?? 0).toFixed(1)}%` },
            { icon: '📅', label: 'Last Active',          value: metrics.last_submission_date || '—' },
            { icon: '🧠', label: 'Skills Learned',       value: `${metrics.learned_skills?.length ?? 0} skills` },
            { icon: '📊', label: 'Skill Areas Tracked',  value: `${Object.keys(metrics.skill_distribution ?? {}).length} areas` },
            { icon: '🚀', label: 'XP To Next Level',     value: `${nextTier - xp} XP remaining` },
            { icon: '🏆', label: 'Level Progress',       value: `${Math.round(xpProgress)}%` },
          ].map(({ icon, label, value }) => (
            <div key={label} style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-color)',
              borderRadius: '12px',
              padding: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.35rem',
            }}>
              <span style={{ fontSize: '1.3rem' }}>{icon}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Learned Skills full list ── */}
      {metrics.learned_skills?.length > 0 && (
        <div className="result-card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.9rem' }}>All Learned Skills <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>({metrics.learned_skills.length})</span></h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {metrics.learned_skills.map(skill => (
              <span key={skill} style={{
                padding: '0.3rem 0.85rem', borderRadius: '999px', fontSize: '0.82rem', fontWeight: 600,
                background: 'rgba(0,240,255,0.08)', border: '1px solid rgba(0,240,255,0.25)',
                color: 'var(--accent-primary)',
              }}>
                {skill}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default App
