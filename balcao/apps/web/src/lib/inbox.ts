import type { ConversationMode, ConversationStatus, MessageDirection, MessageSender, MessageStatus, MessageType, OrderStatus } from '@balcao/shared';
import { formatPhone } from '@balcao/shared';
import type { InboxListResponse } from './queries';

export type ConversationSummary = InboxListResponse['conversations'][number];

export interface InboxMessage {
  id: string;
  direction: MessageDirection;
  sender: MessageSender;
  senderName: string | null;
  type: MessageType;
  body: string | null;
  hasMedia: boolean;
  mediaUrl: string | null;
  mediaMime: string | null;
  templateName: string | null;
  status: MessageStatus;
  error: string | null;
  createdAt: string;
  statusAt: string | null;
}

export interface ConversationDetail {
  conversation: {
    id: string;
    contactId: string;
    contactName: string | null;
    customerId: string | null;
    status: ConversationStatus;
    mode: ConversationMode;
    assignedUserId: string | null;
    assignedUserName: string | null;
    unreadCount: number;
    lastInboundAt: string | null;
    handoffReason: string | null;
    handoffAt: string | null;
    closedAt: string | null;
    windowOpen: boolean;
  };
  messages: InboxMessage[];
  customer: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    notes: string | null;
    tags: string[];
    createdAt: string;
    marketingOptIn: boolean;
    ordersCount: number;
    totalSpentCents: number;
    averageTicketCents: number;
    lastOrderAt: string | null;
    recentOrders: { id: string; number: number; status: OrderStatus; totalCents: number; createdAt: string }[];
    address: { street: string; number: string; complement: string | null; neighborhood: string; city: string; state: string; reference: string | null } | null;
  } | null;
  team: { id: string; name: string }[];
}

export interface QuickReply {
  id: string;
  title: string;
  body: string;
}

export function contactLabel(c: { customerName?: string | null; contactName: string | null; contactId: string }) {
  return c.customerName || c.contactName || formatPhone(c.contactId);
}

export function initials(name: string) {
  const parts = name.replace(/[^\p{L}\s]/gu, '').trim().split(/\s+/);
  if (!parts[0]) return '#';
  return ((parts[0][0] ?? '') + (parts.length > 1 ? (parts.at(-1)![0] ?? '') : '')).toUpperCase();
}
