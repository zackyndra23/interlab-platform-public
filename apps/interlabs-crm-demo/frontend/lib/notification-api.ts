import { api } from './api';
import type {
  NotificationSender,
  NotificationTemplateRow,
  TemplateExtraRecipient,
  MyNotificationTemplateRow,
} from './notification-types';

export const notificationApi = {
  // Senders
  listSenders: () =>
    api
      .get<{ data: { items: NotificationSender[] } }>('/api/admin/notification-senders')
      .then(r => r.data.data.items),
  createSender: (body: Partial<NotificationSender>) =>
    api
      .post<{ data: NotificationSender }>('/api/admin/notification-senders', body)
      .then(r => r.data.data),
  updateSender: (id: string, patch: Partial<NotificationSender>) =>
    api
      .patch<{ data: NotificationSender }>(`/api/admin/notification-senders/${id}`, patch)
      .then(r => r.data.data),
  deleteSender: (id: string) =>
    api.delete(`/api/admin/notification-senders/${id}`).then(r => r.data),

  // Templates
  listTemplates: () =>
    api
      .get<{ data: { items: NotificationTemplateRow[] } }>('/api/admin/notification-templates')
      .then(r => r.data.data.items),
  getTemplate: (id: string) =>
    api
      .get<{
        data: {
          template: NotificationTemplateRow;
          extra_recipients: TemplateExtraRecipient[];
        };
      }>(`/api/admin/notification-templates/${id}`)
      .then(r => r.data.data),
  patchTemplate: (id: string, patch: Partial<NotificationTemplateRow>) =>
    api
      .patch<{ data: NotificationTemplateRow }>(`/api/admin/notification-templates/${id}`, patch)
      .then(r => r.data.data),
  setExtraRecipients: (id: string, user_ids: string[]) =>
    api
      .put(`/api/admin/notification-templates/${id}/extra-recipients`, { user_ids })
      .then(r => r.data),

  // My mutes
  listMyTemplates: () =>
    api
      .get<{ data: { items: MyNotificationTemplateRow[] } }>('/api/users/me/notifications/templates')
      .then(r => r.data.data.items),
  mute: (templateId: string) =>
    api
      .post(`/api/users/me/notifications/mutes/${templateId}`, {})
      .then(r => r.data),
  unmute: (templateId: string) =>
    api
      .delete(`/api/users/me/notifications/mutes/${templateId}`)
      .then(r => r.data),
};
