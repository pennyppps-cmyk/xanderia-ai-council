export type Role = 'employee' | 'dept_lead' | 'admin';
export type Mode = 'auto' | 'quick' | 'council';
export type Status = 'queued' | 'running' | 'done' | 'error';

export interface User {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  department_id: string;
  locale: string;
}

export interface Me {
  user: User;
  department: { slug: string; name: string };
  canUseCouncil: boolean;
}

export interface Department {
  id: string;
  slug: string;
  name: string;
  name_ms: string | null;
  description: string | null;
  review_before_acting: boolean;
}

export interface Persona {
  key: string;
  name: string;
  name_ms: string | null;
  description: string | null;
  in_council: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  pinned: boolean;
  updated_at: string;
  department_id: string;
  department_name: string;
  last_status: Status | null;
}

export type Level = 'low' | 'medium' | 'high';

export interface Stance {
  value: 'for' | 'conditional' | 'against' | 'unclear';
  strength: number | null;
  position: string | null;
}

export interface ClarifyRequest {
  questions: string[];
  assumptions: string[];
}

export interface Verdict {
  verdict: string;
  why: string;
  conflicts: Array<{ between: string; position_a: string; position_b: string; decision: string; because: string }>;
  action_plan: Array<{ step: string; owner_role: string; timeline: string; start_week?: number; duration_weeks?: number }>;
  risks: Array<{ risk: string; mitigation: string; likelihood?: Level; impact?: Level }>;
  open_questions: string[];
  confidence: { level: 'low' | 'medium' | 'high'; what_would_change: string };
}

export interface RouterInfo {
  department: string;
  intent: 'question' | 'plan' | 'decision';
  contains_pii: boolean;
  sensitivity: 'low' | 'high';
  suggested_mode: 'quick' | 'council';
  language: 'en' | 'ms';
  reason: string;
  source: 'model' | 'fallback';
}

export interface Citation {
  id: string;
  documentId: string;
  title: string;
  section: string | null;
}

export interface Part {
  stage: number;
  kind: 'opinion' | 'review';
  persona_key: string;
  persona_name?: string;
  anon_label: string | null;
  content: string;
  data: { scores?: Record<string, { score: number; flaw: string }>; stance?: Stance; error?: string | null } | null;
  model: string | null;
  latency_ms: number | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  reply_to: string | null;
  requested_mode: Mode | null;
  mode: 'quick' | 'council' | 'clarify' | null;
  department_id: string | null;
  status: Status;
  stage: string | null;
  options: { peerReview?: boolean; skipClarify?: boolean; clarify?: ClarifyRequest; effectiveQuestion?: string };
  router: RouterInfo | null;
  verdict: Verdict | null;
  citations: Citation[] | null;
  cloud_used: boolean;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  my_rating?: 1 | -1 | null;
  parts: Part[];
}
