export interface ConversationNote {
  id: string;
  author: string;
  text: string;
  ts: string;
  system: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  sentiment: 'Positive' | 'Negative' | 'Neutral' | string;
  intent: string;
  summary: string;
  intercom_id: string | null;
  original_text: string | null;
  analyzed_at: string;
  dissatisfaction_severity: 'Low' | 'Medium' | 'High' | 'Critical';
  issue_category: string;
  resolution_status: 'Resolved' | 'Partially Resolved' | 'Unresolved';
  language: string;
  agent_performance_score: number | null;
  agent_performance_notes: string;
  key_quotes: string;
  recommended_action: string;
  is_alert_worthy: boolean;
  alert_reason: string | null;
  notes: ConversationNote[];
}

export interface PromptVersion {
  id: string;
  content: string;
  createdAt: string;
  label: string;
  active: boolean;
}

export interface AnalysisResult {
  language: string;
  summary: string;
  dissatisfaction_severity: string;
  issue_category: string;
  resolution_status: string;
  key_quotes: string;
  agent_performance_score: number | null;
  agent_performance_notes: string;
  recommended_action: string;
  is_alert_worthy: boolean;
  alert_reason: string | null;
  conversation_id?: string;
  player_id?: string;
  agent_name?: string;
  intercom_link?: string;
  is_bot_handled?: boolean;
}
