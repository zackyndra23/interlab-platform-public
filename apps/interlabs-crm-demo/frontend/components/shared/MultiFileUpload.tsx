'use client';

import * as React from 'react';
import { Download, Eye, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { FilePreviewModal } from './FilePreviewModal';
import { IconButton } from './IconButton';

/**
 * File upload panel — uploads each file IMMEDIATELY on selection per
 * IMPL_frontend §F9 attachment rules. Returns the server-assigned
 * `file_id`s via onChange so the parent form can submit references
 * instead of raw data.
 *
 * Preview integration: images and PDFs get a Preview icon that opens
 * FilePreviewModal inline. Non-previewable types (office docs, zip)
 * omit the preview action and fall back to download.
 */

function isPreviewable(file: UploadedFile): boolean {
    const mime = file.mime_type || '';
    return mime.startsWith('image/') || mime === 'application/pdf';
}

export type UploadedFile = {
    id: string;
    original_filename: string;
    mime_type: string | null;
    size_bytes?: number | null;
    created_at?: string;
};

export type MultiFileUploadProps = {
    entityModule: string;
    entityId?: string | null;
    existingFiles?: UploadedFile[];
    onChange: (fileIds: string[]) => void;
    accept?: string;
    maxFiles?: number;
    maxSizeMB?: number;
    onPreview?: (file: UploadedFile) => void;
    disabled?: boolean;
};

export function MultiFileUpload({
    entityModule, entityId = null,
    existingFiles = [],
    onChange,
    accept = '.pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.webp,.zip',
    maxFiles = 10,
    maxSizeMB = 25,
    onPreview,
    disabled,
}: MultiFileUploadProps) {
    const [files, setFiles] = React.useState<UploadedFile[]>(existingFiles);
    const [uploading, setUploading] = React.useState(0);
    const [previewFile, setPreviewFile] = React.useState<UploadedFile | null>(null);
    const inputRef = React.useRef<HTMLInputElement>(null);

    function handlePreview(file: UploadedFile): void {
        if (onPreview) { onPreview(file); return; }
        setPreviewFile(file);
    }

    // Hoist changes so the parent form always has the current id list.
    React.useEffect(() => {
        onChange(files.map((f) => f.id));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [files]);

    async function handleSelect(list: FileList | null): Promise<void> {
        if (!list || list.length === 0) return;
        const chosen = Array.from(list).slice(0, Math.max(0, maxFiles - files.length));
        for (const f of chosen) {
            if (f.size > maxSizeMB * 1024 * 1024) {
                toast.error(`${f.name} exceeds ${maxSizeMB}MB limit`);
                continue;
            }
            setUploading((n) => n + 1);
            try {
                const form = new FormData();
                form.append('file', f);
                form.append('related_module', entityModule);
                if (entityId) form.append('related_entity_id', entityId);

                const res = await api.post('/api/files/upload', form, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                const uploaded = res.data?.data as UploadedFile | undefined;
                if (uploaded?.id) {
                    setFiles((prev) => [...prev, uploaded]);
                } else {
                    toast.error(`Failed to upload ${f.name}`);
                }
            } catch (err) {
                toast.error(
                    err instanceof Error ? err.message : `Upload failed for ${f.name}`,
                );
            } finally {
                setUploading((n) => n - 1);
            }
        }
        if (inputRef.current) inputRef.current.value = '';
    }

    async function download(file: UploadedFile): Promise<void> {
        try {
            const res = await api.get(`/api/files/${file.id}/presigned-url`);
            const url = res.data?.data?.url as string | undefined;
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        } catch {
            toast.error('Could not generate download link');
        }
    }

    function remove(id: string): void {
        setFiles((prev) => prev.filter((f) => f.id !== id));
    }

    return (
        <div className="space-y-2">
            <label className={cn(
                'flex cursor-pointer items-center justify-center gap-2 rounded-md border',
                'border-dashed border-input bg-background p-4 text-sm text-muted-foreground',
                'hover:bg-accent',
                disabled && 'pointer-events-none opacity-50',
            )}>
                <Upload size={16} />
                <span>
                    {uploading > 0
                        ? `Uploading ${uploading}…`
                        : `Click to upload (max ${maxFiles} files, ${maxSizeMB}MB each)`}
                </span>
                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    hidden
                    accept={accept}
                    disabled={disabled}
                    onChange={(e) => handleSelect(e.target.files)}
                />
            </label>

            {files.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                    {files.map((f) => (
                        <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                            <span className="flex-1 truncate">{f.original_filename}</span>
                            {isPreviewable(f) && (
                                <IconButton
                                    icon={Eye}
                                    tooltip="Preview"
                                    onClick={() => handlePreview(f)}
                                />
                            )}
                            <IconButton
                                icon={Download}
                                tooltip="Download"
                                onClick={() => download(f)}
                            />
                            {!disabled && (
                                <IconButton
                                    icon={Trash2}
                                    tooltip="Remove"
                                    variant="danger"
                                    onClick={() => remove(f.id)}
                                />
                            )}
                        </li>
                    ))}
                </ul>
            )}

            <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
        </div>
    );
}
