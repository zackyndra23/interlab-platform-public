import {
    LayoutDashboard,
    Bell, MessageSquare, Package,
    Users, FileText, ClipboardList, ShoppingCart, Receipt, DollarSign,
    Truck, PackageOpen, FileBarChart, Wrench, CircleCheck, FileSignature,
    Search, FolderLock, Mail, Archive, ShieldAlert,
    FileSpreadsheet,
    Activity,
    Cog,
    Settings as SettingsIcon,
    type LucideIcon,
} from 'lucide-react';

import type { RoleKey } from '@/lib/rbac';

export type NavItem = {
    /** Stable key — also used for active-state matching. */
    key: string;
    label: string;
    href: string;
    icon: LucideIcon;
    /** Roles that see this item. 'superadmin' and 'ceo' always see everything. */
    roles?: RoleKey[];
    /** When present, menu item only shows if the feature is in the role's
     *  ownership map (see rbac.roleOwnsFeature). */
    feature?: string;
};

/** Top section of the sidebar — Dashboard is always first. */
export const SHARED_TOP: NavItem[] = [
    { key: 'dashboard', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
];

/** Per-role navigation groups. Each division owns its slab; Sidebar
 *  filters by the logged-in user's role. Order within each group follows
 *  the MOD_ file sidebar specs. */
export const MODULE_NAV: Record<RoleKey, NavItem[]> = {
    superadmin: [
        { key: 'sales.customers',        label: 'Customers',          href: '/sales/customers', icon: Users,        feature: 'customer' },
        { key: 'sales.forecasts',        label: 'Sales Forecast',     href: '/sales/forecasts', icon: FileBarChart, feature: 'sales_forecast' },
        { key: 'sales.quotations',       label: 'Quotations',         href: '/sales/quotations', icon: FileText,    feature: 'quotation' },
        { key: 'sales.hpp',              label: 'HPP',                href: '/sales/hpp', icon: Receipt,           feature: 'harga_pokok_penjualan' },
        { key: 'sales.po',               label: 'Sales PO',           href: '/sales/purchase-orders', icon: ShoppingCart, feature: 'sales_po' },
        { key: 'sales.pr',               label: 'Purchase Requests',  href: '/sales/purchase-requests', icon: ClipboardList, feature: 'purchase_request' },
        { key: 'admin_log.awb',          label: 'AWB',                href: '/admin-log/awb', icon: Truck,          feature: 'awb' },
        { key: 'admin_log.do',           label: 'Delivery Orders',    href: '/admin-log/delivery-orders', icon: PackageOpen, feature: 'delivery_order' },
        { key: 'admin_log.ops',          label: 'Operational',        href: '/admin-log/operational', icon: FileBarChart, feature: 'admin_operational' },
        { key: 'finance.po_customer',    label: 'PO Customer',        href: '/finance/po-customers', icon: ShoppingCart, feature: 'po_customer' },
        { key: 'finance.pr',             label: 'Purchase Requisition', href: '/finance/purchase-requisitions', icon: ClipboardList, feature: 'purchase_requisition' },
        { key: 'finance.inv_mfg',        label: 'Invoice Manufacture', href: '/finance/invoice-manufactures', icon: DollarSign, feature: 'invoice_manufacture' },
        { key: 'finance.inv_cust',       label: 'Invoice Customer',    href: '/finance/invoice-customers', icon: DollarSign, feature: 'invoice_customer' },
        { key: 'technical.jo',           label: 'Job Orders',         href: '/technical/job-orders', icon: Wrench,     feature: 'technical_job_order' },
        { key: 'technical.install',      label: 'Installations',      href: '/technical/installations', icon: Wrench,  feature: 'installation' },
        { key: 'technical.pm',           label: 'PM',                 href: '/technical/pm', icon: Wrench,              feature: 'pm' },
        { key: 'technical.sparepart',    label: 'Spareparts',         href: '/technical/spareparts', icon: Package,      feature: 'sparepart' },
        { key: 'technical.qc',           label: 'Inspection & QC',    href: '/technical/inspection-qc', icon: CircleCheck, feature: 'inspection_qc' },
        { key: 'technical.bast',         label: 'BAST',               href: '/technical/bast', icon: FileSignature,  feature: 'bast' },
        { key: 'hrga.search',            label: 'Smart Search',       href: '/hrga/smart-search', icon: Search,     feature: 'hrga_legal' },
        { key: 'hrga.legalitas',         label: 'Legalitas',          href: '/hrga/legalitas', icon: FolderLock,   feature: 'hrga_legal' },
        { key: 'hrga.letters',           label: 'Company Letters',    href: '/hrga/company-letters', icon: Mail,    feature: 'company_letters' },
        { key: 'hrga.archive',           label: 'Archive',            href: '/hrga/archive', icon: Archive,         feature: 'hrga_archive' },
        { key: 'hrga.compliance',        label: 'Compliance',         href: '/hrga/compliance', icon: ShieldAlert, feature: 'hrga_compliance' },
        { key: 'tax.operational',        label: 'Tax Operational',    href: '/tax/operational', icon: FileSpreadsheet, feature: 'tax_operational' },
        { key: 'activity_log',           label: 'Activity Logs',      href: '/activity-logs', icon: Activity },
    ],
    ceo: [], // replaced at runtime with superadmin's full list
    sales: [
        { key: 'sales.customers',  label: 'Customers',         href: '/sales/customers',         icon: Users },
        { key: 'sales.forecasts',  label: 'Sales Forecast',    href: '/sales/forecasts',         icon: FileBarChart },
        { key: 'sales.quotations', label: 'Quotations',        href: '/sales/quotations',        icon: FileText },
        { key: 'sales.hpp',        label: 'HPP',               href: '/sales/hpp',               icon: Receipt },
        { key: 'sales.po',         label: 'Purchase Order',    href: '/sales/purchase-orders',   icon: ShoppingCart },
        { key: 'sales.pr',         label: 'Purchase Request',  href: '/sales/purchase-requests', icon: ClipboardList },
    ],
    admin_log: [
        { key: 'admin_log.awb', label: 'AWB',             href: '/admin-log/awb',              icon: Truck },
        { key: 'admin_log.do',  label: 'Delivery Orders', href: '/admin-log/delivery-orders', icon: PackageOpen },
        { key: 'admin_log.ops', label: 'Operational',     href: '/admin-log/operational',     icon: FileBarChart },
    ],
    finance: [
        { key: 'finance.po_customer', label: 'PO Customer',          href: '/finance/po-customers',          icon: ShoppingCart },
        { key: 'finance.pr',          label: 'Purchase Requisition', href: '/finance/purchase-requisitions', icon: ClipboardList },
        { key: 'finance.inv_mfg',     label: 'Invoice Manufacture',  href: '/finance/invoice-manufactures',  icon: DollarSign },
        { key: 'finance.inv_cust',    label: 'Invoice Customer',     href: '/finance/invoice-customers',     icon: DollarSign },
    ],
    technical: [
        { key: 'technical.jo',        label: 'Job Orders',      href: '/technical/job-orders',      icon: Wrench },
        { key: 'technical.install',   label: 'Installations',   href: '/technical/installations',   icon: Wrench },
        { key: 'technical.pm',        label: 'PM',              href: '/technical/pm',              icon: Wrench },
        { key: 'technical.sparepart', label: 'Spareparts',      href: '/technical/spareparts',      icon: Package },
        { key: 'technical.qc',        label: 'Inspection & QC', href: '/technical/inspection-qc',   icon: CircleCheck },
        { key: 'technical.bast',      label: 'BAST',            href: '/technical/bast',            icon: FileSignature },
    ],
    hrga: [
        { key: 'hrga.search',     label: 'Smart Search',    href: '/hrga/smart-search',    icon: Search },
        { key: 'hrga.legalitas',  label: 'Legalitas',       href: '/hrga/legalitas',       icon: FolderLock },
        { key: 'hrga.letters',    label: 'Company Letters', href: '/hrga/company-letters', icon: Mail },
        { key: 'hrga.archive',    label: 'Archive',         href: '/hrga/archive',         icon: Archive },
        { key: 'hrga.compliance', label: 'Compliance',      href: '/hrga/compliance',      icon: ShieldAlert },
    ],
    tax_insurance: [
        { key: 'tax.operational', label: 'Tax Operational', href: '/tax/operational', icon: FileSpreadsheet },
    ],
};

/** Globally shared nav items appended after module items. */
export const SHARED_GLOBAL: NavItem[] = [
    { key: 'notifications', label: 'Notifications', href: '/notifications', icon: Bell },
    { key: 'chat',          label: 'Chat',          href: '/chat',          icon: MessageSquare },
    { key: 'po_tracking',   label: 'PO Tracking',   href: '/po-tracking',   icon: Package },
];

/** Setup submenu items. Available to every role; Roles page inside does
 *  its own scoping (Superadmin/CEO see all, others see own role). */
export const SETUP_ITEMS: NavItem[] = [
    { key: 'setup.roles',          label: 'Roles',           href: '/setup/roles',           icon: Users },
    { key: 'setup.email_templates', label: 'Email Templates', href: '/setup/email-templates', icon: Cog },
    { key: 'setup.settings',       label: 'Settings',        href: '/setup/settings',        icon: SettingsIcon },
];

export function navForRole(role: RoleKey): NavItem[] {
    if (role === 'ceo') return MODULE_NAV.superadmin;
    return MODULE_NAV[role] || [];
}
