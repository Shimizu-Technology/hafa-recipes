import type { ReportCategory, SafetyReport, SafetyReviewStatus } from '@/types/communitySafety';

export const REPORT_CATEGORY_OPTIONS: ReadonlyArray<{
  value: ReportCategory;
  label: string;
  description: string;
}> = [
  { value: 'spam', label: 'Spam', description: 'Promotional, repetitive, or misleading content' },
  { value: 'unsafe', label: 'Unsafe cooking advice', description: 'Instructions that could cause harm' },
  { value: 'inappropriate', label: 'Inappropriate content', description: 'Abusive, sexual, or hateful material' },
  { value: 'copyright', label: 'Copyright concern', description: 'Content shared without permission' },
  { value: 'impersonation', label: 'Impersonation', description: 'Pretending to be another person or business' },
  { value: 'other', label: 'Something else', description: 'A concern not listed above' },
];

export const REVIEW_STATUS_LABELS: Record<SafetyReviewStatus, string> = {
  open: 'Submitted',
  reviewing: 'Under review',
  resolved: 'Resolved',
  dismissed: 'Closed',
};

export function canSubmitReport(category: ReportCategory | null, details: string): boolean {
  if (!category) return false;
  if (category === 'other') return details.trim().length >= 10;
  return true;
}

export function canSubmitAppeal(details: string): boolean {
  return details.trim().length >= 10;
}

export function formatSafetyItemTitle(report: SafetyReport): string {
  if (report.category === 'appeal') {
    return report.target_type === 'recipe' ? 'Recipe appeal' : 'Account appeal';
  }
  return report.target_type === 'recipe' ? 'Recipe report' : 'Contributor report';
}

export function getSafetyErrorMessage(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === 'string' && detail.length <= 180) return detail;
  return 'Something went wrong. Please try again.';
}
