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
  // Added with the LLM-council verdict format; older verdicts do not have them.
  agreements?: string[];
  blind_spots?: string[];
  first_step?: string;
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
  red_flag?: 'none' | 'harassment' | 'data_misuse' | 'fraud' | 'discrimination' | 'other';
  red_flag_reason?: string;
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
  options: {
    peerReview?: boolean;
    skipClarify?: boolean;
    clarify?: ClarifyRequest;
    effectiveQuestion?: string;
    understoodFromFollowUp?: boolean;
    attachmentNames?: string[];
    attachmentNote?: string;
    memory?: { lessons: number; approved: number; rules: number };
  };
  /** Documents attached to a user message. */
  attachments?: Array<{ id: string; filename: string; chars: number }>;
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

// ── Action Crew ──────────────────────────────────────────────────────────────

export type TaskStatus = 'draft' | 'sent' | 'accepted' | 'in_progress' | 'running' | 'review' | 'done' | 'blocked' | 'cant_do' | 'cancelled';

export interface PlanSummary {
  id: string;
  // Null for plans that come from a routine, a data file or a meeting rather than a council verdict.
  message_id: string | null;
  conversation_id: string | null;
  source?: 'council' | 'routine' | 'data' | 'meeting';
  source_id?: string | null;
  title: string;
  status: 'planning' | 'ready' | 'launched' | 'done' | 'cancelled' | 'error';
  error: string | null;
  created_at: string;
  launched_at: string | null;
  total: number;
  done: number;
  overdue: number;
}

export interface Person {
  id: string;
  name: string;
  position: string;
  email: string;
  department?: string | null;
}

export interface CrewTask {
  id: string;
  plan_id: string;
  seq: number;
  title: string;
  description: string;
  owner_type: 'human' | 'agent';
  owner_role: string | null;
  directory_id: string | null;
  resolution: 'resolved' | 'choose' | 'unassigned' | 'agent';
  candidates: Person[];
  collaborators?: Array<Person & { reason: string }>;
  depends_on: number[];
  due_date: string | null;
  status: TaskStatus;
  email_subject: string | null;
  email_body: string | null;
  approved: boolean;
  response_note: string | null;
  agent_output: string | null;
  sent_at: string | null;
  acknowledged_at: string | null;
  completed_at: string | null;
  escalation_state: 'none' | 'pending' | 'sent' | 'declined';
  snoozed_until: string | null;
  owner_name: string | null;
  owner_position: string | null;
  owner_email: string | null;
  manager_email: string | null;
  emails?: Array<{ kind: string; status: string; to: string; send_after: string; sent_at: string | null }> | null;
  events?: Array<{ kind: string; at: string; actor: string; detail: Record<string, unknown> }> | null;
  plan_title?: string;
  requester_name?: string;
}

export interface CrewAgent {
  key: 'dispatcher' | 'herald' | 'tracker' | 'runner';
  name: string;
  busy: boolean;
  status: string;
}

export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}
