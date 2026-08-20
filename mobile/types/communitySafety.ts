export type SafetyTargetType = 'recipe' | 'contributor';

export type ReportCategory =
  | 'spam'
  | 'unsafe'
  | 'inappropriate'
  | 'copyright'
  | 'impersonation'
  | 'other';

export type SafetyReviewStatus = 'open' | 'reviewing' | 'resolved' | 'dismissed';

export interface SafetyReport {
  id: string;
  target_type: SafetyTargetType;
  target_id: string | null;
  category: ReportCategory | 'appeal';
  status: SafetyReviewStatus;
  created_at: string;
}

export interface ReportCreatePayload {
  target_type: SafetyTargetType;
  recipe_id?: string;
  contributor_id?: string;
  category: ReportCategory;
  details?: string;
}

export interface AppealCreatePayload {
  target_type: SafetyTargetType;
  recipe_id?: string;
  details: string;
}

export interface BlockedContributor {
  contributor_id: string;
  display_name: string;
  created_at: string;
}

export interface SafetyStatus {
  account_moderation_status: 'active' | 'hidden';
}
