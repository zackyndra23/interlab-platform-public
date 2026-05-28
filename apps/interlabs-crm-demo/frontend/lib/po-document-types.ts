export const PO_STAGES = [
  'Registered','Processed','Production','Shipped','Customs','Arrived',
  'Inspected','Delivery','Installation','BAST','Invoice',
] as const;
export type POStage = typeof PO_STAGES[number];

export interface PoDocumentType {
  id: string;
  doc_key: string;
  doc_name: string;
  triggers_stage: POStage | null;
  required_for_stage: POStage | null;
  uploader_role_keys: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PoStageHistoryRow {
  id: string;
  status_code: string;
  status_label: string;
  is_rejection: boolean;
  is_admin_override: boolean;
  reject_count_after: number | null;
  note: string | null;
  updated_by_user_id: string;
  updated_by_role: string;
  created_at: string;
}
