export type NotificationProvider = 'smtp' | 'gmail' | 'ses' | 'postmark' | 'resend';

export interface NotificationSender {
  id: string;
  sender_key: string;
  display_name: string;
  from_email: string;
  reply_to_email: string | null;
  provider: NotificationProvider;
  provider_config_key: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface NotificationTemplateRow {
  id: string;
  template_key: string;
  template_name: string;
  feature_group: string;
  trigger_event: string;
  recipient_roles_json: string[];
  send_email_enabled: boolean;
  send_dashboard_notification_enabled: boolean;
  status: 'enabled' | 'disabled';
  subject: string | null;
  body: string | null;
  sender_id: string | null;
  updated_at: string;
}

export interface TemplateExtraRecipient {
  user_id: string;
  email: string;
  display_name: string;
}

export interface MyNotificationTemplateRow {
  id: string;
  template_key: string;
  template_name: string;
  feature_group: string;
  muted: boolean;
}
