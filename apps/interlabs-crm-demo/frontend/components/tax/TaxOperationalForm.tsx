'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { FormField } from '@/components/shared/FormField';
import { MultiFileUpload } from '@/components/shared/MultiFileUpload';
import { SearchDropdown } from '@/components/shared/SearchDropdown';
import { DatePicker } from '@/components/shared/DatePicker';
import { MonthPicker } from '@/components/shared/MonthPicker';
import { CurrencyInput } from '@/components/shared/CurrencyInput';
import { Input } from '@/components/ui/Input';
import { useFormDraft } from '@/hooks/useFormDraft';
import { taxOperationalApi } from '@/lib/tax-api';
import {
    BANK_OPTIONS, JENIS_SPT, PAYMENT_STATUSES, RECORD_STATUSES,
    STATUS_SPT, TAX_CATEGORIES, TAX_TYPES,
    showSptFields, showSspFields, yearOptions,
} from '@/lib/tax-ui';
import type {
    Currency, PaymentStatus, RecordStatus,
    TaxCategory, TaxOperationalCreateInput,
    TaxOperationalRecord, TaxOperationalUpdateInput, TaxType,
} from '@/lib/tax-types';

import { DraftBanner } from '@/components/sales/DraftBanner';
import { FormActions } from '@/components/sales/FormActions';

/**
 * Tax Operational (SSP payment + SPT reporting) form. Drives both create
 * and edit. Field visibility follows MOD_tax_insurance §Conditional Field
 * Logic:
 *
 *   SSP Payment     → SPT section hidden (server forbids those fields)
 *   SPT Reporting   → SSP section hidden
 *   Combined Record → both sections rendered
 *
 * Archived records are read-only (mirrors service.js ConflictError on
 * edit / delete when record_status === 'Archived').
 */

// ---------------------------------------------------------------------------
// FORM SCHEMA
//
// We keep the schema permissive for hidden fields so that toggling the
// tax_category from Combined → SSP Payment doesn't fail validation when the
// user has already filled SPT fields that we're about to strip on submit.
// The actual gating runs at submit time based on the CURRENT tax_category.
// ---------------------------------------------------------------------------

const schema = z.object({
    tax_type: z.enum(TAX_TYPES as [TaxType, ...TaxType[]]),
    tax_category: z.enum(TAX_CATEGORIES as [TaxCategory, ...TaxCategory[]]),
    npwp: z.string().min(1, 'NPWP is required'),

    masa_pajak_month: z.preprocess(
        (v) => (typeof v === 'number' && Number.isNaN(v) ? null : v),
        z.union([z.number().int().min(1).max(12), z.null()]),
    ),
    masa_pajak_year: z.preprocess(
        (v) => (typeof v === 'number' && Number.isNaN(v) ? null : v),
        z.union([z.number().int().min(2000).max(2100), z.null()]),
    ),
    tahun_pajak: z.preprocess(
        (v) => (typeof v === 'number' && Number.isNaN(v) ? null : v),
        z.union([z.number().int().min(2000).max(2100), z.null()]),
    ),

    taxpayer_name: z.string().nullable().optional(),
    taxpayer_address: z.string().nullable().optional(),

    // SPT block
    jenis_spt: z.string().nullable().optional(),
    status_spt: z.string().nullable().optional(),
    reporting_date: z.string().nullable().optional(),

    // SSP block
    billing_code: z.string().nullable().optional(),
    ntpn: z.string().nullable().optional(),
    ntb: z.string().nullable().optional(),
    stan: z.string().nullable().optional(),
    bank_name: z.string().nullable().optional(),
    payment_date: z.string().nullable().optional(),
    amount: z.union([z.number().nonnegative(), z.null()]),
    currency: z.enum(['IDR', 'USD', 'EUR']),

    payment_status: z.enum(
        PAYMENT_STATUSES as [PaymentStatus, ...PaymentStatus[]],
    ),
    record_status: z.enum(
        RECORD_STATUSES as [RecordStatus, ...RecordStatus[]],
    ),
    pic_user_id: z.string().uuid().nullable(),
    notes: z.string().nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

function defaults(existing?: TaxOperationalRecord): FormValues {
    const nowYear = new Date().getUTCFullYear();
    return {
        tax_type: existing?.tax_type ?? 'PPh 21',
        tax_category: existing?.tax_category ?? 'Combined Record',
        npwp: existing?.npwp ?? '',
        masa_pajak_month: existing?.masa_pajak_month ?? null,
        masa_pajak_year: existing?.masa_pajak_year ?? null,
        tahun_pajak: existing?.tahun_pajak ?? nowYear,
        taxpayer_name: existing?.taxpayer_name ?? '',
        taxpayer_address: existing?.taxpayer_address ?? '',
        jenis_spt: existing?.jenis_spt ?? '',
        status_spt: existing?.status_spt ?? '',
        reporting_date: existing?.reporting_date ?? '',
        billing_code: existing?.billing_code ?? '',
        ntpn: existing?.ntpn ?? '',
        ntb: existing?.ntb ?? '',
        stan: existing?.stan ?? '',
        bank_name: existing?.bank_name ?? '',
        payment_date: existing?.payment_date ?? '',
        amount: existing?.amount == null
            ? null
            : Number(existing.amount),
        currency: (existing?.currency as Currency) ?? 'IDR',
        payment_status: existing?.payment_status ?? 'Unpaid',
        record_status: existing?.record_status ?? 'Draft',
        pic_user_id: existing?.pic_user_id ?? null,
        notes: existing?.notes ?? '',
    };
}

function toPayload(
    v: FormValues,
    attachments: {
        ssp: string[]; spt: string[]; payment: string[]; supporting: string[];
    },
): TaxOperationalCreateInput {
    // Build common fields first.
    const base: TaxOperationalCreateInput = {
        tax_type: v.tax_type,
        tax_category: v.tax_category,
        npwp: v.npwp.trim(),
        masa_pajak_month: v.masa_pajak_month,
        masa_pajak_year: v.masa_pajak_year,
        tahun_pajak: v.tahun_pajak ?? v.masa_pajak_year ?? null,
        taxpayer_name: v.taxpayer_name || null,
        taxpayer_address: v.taxpayer_address || null,
        payment_status: v.payment_status,
        record_status: v.record_status,
        pic_user_id: v.pic_user_id,
        notes: v.notes || null,
        attachment_supporting_file_ids:
            attachments.supporting.length > 0 ? attachments.supporting : undefined,
    };

    if (showSptFields(v.tax_category)) {
        base.jenis_spt = (v.jenis_spt as TaxOperationalCreateInput['jenis_spt'])
            || null;
        base.status_spt = (v.status_spt as TaxOperationalCreateInput['status_spt'])
            || null;
        base.reporting_date = v.reporting_date || null;
        if (attachments.spt.length > 0) {
            base.attachment_spt_file_ids = attachments.spt;
        }
    }

    if (showSspFields(v.tax_category)) {
        base.billing_code = v.billing_code || null;
        base.ntpn = v.ntpn || null;
        base.ntb = v.ntb || null;
        base.stan = v.stan || null;
        base.bank_name = v.bank_name || null;
        base.payment_date = v.payment_date || null;
        base.amount = v.amount;
        base.currency = v.currency;
        if (attachments.ssp.length > 0) {
            base.attachment_ssp_file_ids = attachments.ssp;
        }
        if (attachments.payment.length > 0) {
            base.attachment_payment_file_ids = attachments.payment;
        }
    }

    return base;
}

type FormMode = 'create' | 'edit';

export function TaxOperationalForm({
    existing, mode = 'create',
}: {
    existing?: TaxOperationalRecord;
    mode?: FormMode;
}) {
    const router = useRouter();
    const [submitting, setSubmitting] = useState(false);
    const [sspFiles, setSspFiles] = useState<string[]>([]);
    const [sptFiles, setSptFiles] = useState<string[]>([]);
    const [paymentFiles, setPaymentFiles] = useState<string[]>([]);
    const [supportingFiles, setSupportingFiles] = useState<string[]>([]);

    const form = useForm<FormValues>({ defaultValues: defaults(existing) });
    const values = form.watch();
    const draft = useFormDraft<FormValues>({
        formKey: `tax.operational.${mode}`,
        recordId: existing?.id ?? 'new',
        currentValues: values,
    });
    const [bannerSeen, setBannerSeen] = useState(false);

    const isReadOnly = mode === 'edit' && existing?.record_status === 'Archived';

    const showSpt = useMemo(() => showSptFields(values.tax_category), [values.tax_category]);
    const showSsp = useMemo(() => showSspFields(values.tax_category), [values.tax_category]);

    async function onSubmit(raw: FormValues): Promise<void> {
        const parsed = schema.safeParse(raw);
        if (!parsed.success) {
            toast.error(parsed.error.issues[0]?.message || 'Validation error');
            return;
        }
        if (!parsed.data.npwp.replace(/\D/g, '')) {
            toast.error('NPWP is required');
            return;
        }
        setSubmitting(true);
        try {
            const payload = toPayload(parsed.data, {
                ssp: sspFiles,
                spt: sptFiles,
                payment: paymentFiles,
                supporting: supportingFiles,
            });

            if (existing) {
                const updatePayload: TaxOperationalUpdateInput = payload;
                await taxOperationalApi.update(existing.id, updatePayload);
                toast.success('Tax record updated');
                draft.clearDraft();
                router.replace(`/tax/operational/${existing.id}`);
            } else {
                const created = await taxOperationalApi.create(payload);
                toast.success('Tax record created');
                draft.clearDraft();
                router.replace(`/tax/operational/${created.id}`);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Save failed');
        } finally {
            setSubmitting(false);
        }
    }

    const submitLabel = existing ? 'Save' : 'Create';

    return (
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {draft.hasDraft && !bannerSeen && (
                <DraftBanner
                    onResume={() => {
                        const d = draft.loadDraft();
                        if (d) form.reset(d);
                        setBannerSeen(true);
                    }}
                    onDiscard={() => { draft.clearDraft(); setBannerSeen(true); }}
                />
            )}

            {isReadOnly && (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
                    This record is Archived. Edits are blocked server-side; view the audit log for history.
                </p>
            )}

            <section className="space-y-3 rounded-md border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">Classification</h3>
                <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Tax Type" name="tax_type" required>
                        <select
                            {...form.register('tax_type')}
                            disabled={isReadOnly}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {TAX_TYPES.map((t) => (
                                <option key={t} value={t}>{t}</option>
                            ))}
                        </select>
                    </FormField>

                    <FormField label="Tax Category" name="tax_category" required
                        hint="Drives which sub-sections (SSP / SPT) appear below.">
                        <select
                            {...form.register('tax_category')}
                            disabled={isReadOnly}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {TAX_CATEGORIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                            ))}
                        </select>
                    </FormField>
                </div>
            </section>

            <section className="space-y-3 rounded-md border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">Tax Period</h3>
                <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Masa Pajak" name="masa_pajak_month"
                        hint="Indonesian tax-period month. Drives monthly roll-ups.">
                        <Controller
                            control={form.control}
                            name="masa_pajak_month"
                            render={({ field: m }) => (
                                <Controller
                                    control={form.control}
                                    name="masa_pajak_year"
                                    render={({ field: y }) => (
                                        <MonthPicker
                                            value={{
                                                month: m.value ?? null,
                                                year: y.value ?? null,
                                            }}
                                            onChange={({ month, year }) => {
                                                m.onChange(month);
                                                y.onChange(year);
                                            }}
                                            disabled={isReadOnly}
                                        />
                                    )}
                                />
                            )}
                        />
                    </FormField>

                    <FormField label="Tahun Pajak" name="tahun_pajak"
                        hint="Tax year — defaults to Masa Pajak year.">
                        <select
                            {...form.register('tahun_pajak', { valueAsNumber: true })}
                            disabled={isReadOnly}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            <option value="">—</option>
                            {yearOptions().map((y) => (
                                <option key={y} value={y}>{y}</option>
                            ))}
                        </select>
                    </FormField>
                </div>
            </section>

            <section className="space-y-3 rounded-md border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">Taxpayer Identity</h3>
                <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="NPWP" name="npwp" required
                        error={form.formState.errors.npwp?.message}
                        hint="15 or 16 digits; separators (dots/dashes) are accepted.">
                        <Input disabled={isReadOnly}
                            placeholder="01.234.567.8-901.000"
                            {...form.register('npwp')} />
                    </FormField>

                    <FormField label="Taxpayer Name" name="taxpayer_name">
                        <Input disabled={isReadOnly}
                            {...form.register('taxpayer_name')} />
                    </FormField>

                    <FormField label="Taxpayer Address" name="taxpayer_address"
                        className="md:col-span-2">
                        <textarea
                            rows={2}
                            disabled={isReadOnly}
                            {...form.register('taxpayer_address')}
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        />
                    </FormField>
                </div>
            </section>

            {showSpt && (
                <section className="space-y-3 rounded-md border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold">SPT Reporting</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Jenis SPT" name="jenis_spt">
                            <select
                                {...form.register('jenis_spt')}
                                disabled={isReadOnly}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                                <option value="">—</option>
                                {JENIS_SPT.map((j) => (
                                    <option key={j} value={j}>{j}</option>
                                ))}
                            </select>
                        </FormField>

                        <FormField label="Status SPT" name="status_spt"
                            hint="Pembetulan = correction/amendment filing.">
                            <select
                                {...form.register('status_spt')}
                                disabled={isReadOnly}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                                <option value="">—</option>
                                {STATUS_SPT.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </FormField>

                        <FormField label="Reporting Date" name="reporting_date"
                            hint="Date SPT was submitted to the tax authority.">
                            <Controller
                                control={form.control}
                                name="reporting_date"
                                render={({ field }) => (
                                    <DatePicker
                                        value={field.value}
                                        onChange={field.onChange}
                                        disabled={isReadOnly}
                                    />
                                )}
                            />
                        </FormField>
                    </div>

                    <div>
                        <p className="mb-1 text-sm font-medium">SPT Attachments</p>
                        <p className="mb-2 text-xs text-muted-foreground">
                            SPT filing proof, bukti penerimaan.
                        </p>
                        <MultiFileUpload
                            entityModule="tax.spt"
                            entityId={existing?.id}
                            onChange={setSptFiles}
                            disabled={isReadOnly}
                        />
                    </div>
                </section>
            )}

            {showSsp && (
                <section className="space-y-3 rounded-md border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold">SSP / Billing &amp; Payment</h3>
                    <div className="grid gap-4 md:grid-cols-2">
                        <FormField label="Billing Code" name="billing_code"
                            hint="Kode Billing — generated by the tax authority.">
                            <Input disabled={isReadOnly}
                                {...form.register('billing_code')} />
                        </FormField>

                        <FormField label="NTPN" name="ntpn"
                            hint="Nomor Transaksi Penerimaan Negara.">
                            <Input disabled={isReadOnly}
                                {...form.register('ntpn')} />
                        </FormField>

                        <FormField label="NTB" name="ntb"
                            hint="Nomor Transaksi Bank (optional).">
                            <Input disabled={isReadOnly}
                                {...form.register('ntb')} />
                        </FormField>

                        <FormField label="STAN" name="stan"
                            hint="System Trace Audit Number (optional).">
                            <Input disabled={isReadOnly}
                                {...form.register('stan')} />
                        </FormField>

                        <FormField label="Bank" name="bank_name">
                            <select
                                {...form.register('bank_name')}
                                disabled={isReadOnly}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                            >
                                <option value="">—</option>
                                {BANK_OPTIONS.map((b) => (
                                    <option key={b} value={b}>{b}</option>
                                ))}
                            </select>
                        </FormField>

                        <FormField label="Payment Date" name="payment_date">
                            <Controller
                                control={form.control}
                                name="payment_date"
                                render={({ field }) => (
                                    <DatePicker
                                        value={field.value}
                                        onChange={field.onChange}
                                        disabled={isReadOnly}
                                    />
                                )}
                            />
                        </FormField>

                        <FormField label="Amount" name="amount"
                            className="md:col-span-2">
                            <Controller
                                control={form.control}
                                name="amount"
                                render={({ field: amt }) => (
                                    <Controller
                                        control={form.control}
                                        name="currency"
                                        render={({ field: cur }) => (
                                            <CurrencyInput
                                                value={amt.value ?? null}
                                                onChange={amt.onChange}
                                                currency={cur.value}
                                                onCurrencyChange={cur.onChange}
                                                disabled={isReadOnly}
                                            />
                                        )}
                                    />
                                )}
                            />
                        </FormField>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                        <div>
                            <p className="mb-1 text-sm font-medium">SSP Attachments</p>
                            <p className="mb-2 text-xs text-muted-foreground">
                                SSP document — uploaded payment confirmation from bank.
                            </p>
                            <MultiFileUpload
                                entityModule="tax.ssp"
                                entityId={existing?.id}
                                onChange={setSspFiles}
                                disabled={isReadOnly}
                            />
                        </div>
                        <div>
                            <p className="mb-1 text-sm font-medium">Payment Proof</p>
                            <p className="mb-2 text-xs text-muted-foreground">
                                Bank transfer proof or NTPN confirmation.
                            </p>
                            <MultiFileUpload
                                entityModule="tax.payment"
                                entityId={existing?.id}
                                onChange={setPaymentFiles}
                                disabled={isReadOnly}
                            />
                        </div>
                    </div>
                </section>
            )}

            <section className="space-y-3 rounded-md border border-border bg-card p-4">
                <h3 className="text-sm font-semibold">Status &amp; Assignment</h3>
                <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Record Status" name="record_status">
                        <select
                            {...form.register('record_status')}
                            disabled={isReadOnly}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {RECORD_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </FormField>

                    <FormField label="Payment Status" name="payment_status">
                        <select
                            {...form.register('payment_status')}
                            disabled={isReadOnly}
                            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                            {PAYMENT_STATUSES.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </FormField>

                    <FormField label="PIC" name="pic_user_id"
                        hint="Person-in-charge — Tax &amp; Insurance user.">
                        <Controller
                            control={form.control}
                            name="pic_user_id"
                            render={({ field }) => (
                                <SearchDropdown
                                    endpoint="/api/users"
                                    labelKey="display_name"
                                    value={field.value}
                                    onChange={field.onChange}
                                    disabled={isReadOnly}
                                />
                            )}
                        />
                    </FormField>
                </div>
            </section>

            <FormField label="Notes" name="notes">
                <textarea
                    rows={3}
                    disabled={isReadOnly}
                    {...form.register('notes')}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
            </FormField>

            <div>
                <p className="mb-1 text-sm font-medium">Supporting Documents</p>
                <p className="mb-2 text-xs text-muted-foreground">
                    Any additional supporting documents (always available regardless of tax category).
                </p>
                <MultiFileUpload
                    entityModule="tax.supporting"
                    entityId={existing?.id}
                    onChange={setSupportingFiles}
                    disabled={isReadOnly}
                />
            </div>

            <FormActions
                onCancel={() => router.back()}
                onSaveDraft={() => { draft.saveNow(); toast.success('Draft saved'); }}
                submitLabel={submitLabel}
                submitting={submitting || isReadOnly}
            />
        </form>
    );
}
