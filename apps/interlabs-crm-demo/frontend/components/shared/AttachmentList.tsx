'use client';

import * as React from 'react';
import { Download, Eye } from 'lucide-react';
import { toast } from 'sonner';

import { api } from '@/lib/api';
import { formatDate } from '@/lib/utils';
import { FilePreviewModal } from './FilePreviewModal';
import { IconButton } from './IconButton';
import type { UploadedFile } from './MultiFileUpload';

/**
 * Read-only attachment list for detail pages. Mirrors the MultiFileUpload
 * existing-files row rendering but strips the upload input and the remove
 * action — detail pages never mutate files. Preview logic matches
 * MultiFileUpload.isPreviewable (images + PDFs); everything else falls
 * back to download only.
 */

function isPreviewable(file: UploadedFile): boolean {
    const mime = file.mime_type || '';
    return mime.startsWith('image/') || mime === 'application/pdf';
}

function formatSize(bytes: number | null | undefined): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type AttachmentListProps = {
    files: UploadedFile[];
    emptyMessage?: string;
};

export function AttachmentList({
    files,
    emptyMessage = 'No attachments',
}: AttachmentListProps) {
    const [previewFile, setPreviewFile] = React.useState<UploadedFile | null>(null);

    async function download(file: UploadedFile): Promise<void> {
        try {
            const res = await api.get(`/api/files/${file.id}/presigned-url`);
            const url = res.data?.data?.url as string | undefined;
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
        } catch {
            toast.error('Could not generate download link');
        }
    }

    if (files.length === 0) {
        return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
    }

    return (
        <>
            <ul className="divide-y divide-border rounded-md border border-border">
                {files.map((f) => {
                    const meta = [
                        formatSize(f.size_bytes),
                        f.created_at ? formatDate(f.created_at) : '',
                    ].filter(Boolean).join(' · ');
                    return (
                        <li key={f.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                            <div className="min-w-0 flex-1">
                                <p className="truncate">{f.original_filename}</p>
                                {meta && (
                                    <p className="text-xs text-muted-foreground">{meta}</p>
                                )}
                            </div>
                            {isPreviewable(f) && (
                                <IconButton
                                    icon={Eye}
                                    tooltip="Preview"
                                    onClick={() => setPreviewFile(f)}
                                />
                            )}
                            <IconButton
                                icon={Download}
                                tooltip="Download"
                                onClick={() => download(f)}
                            />
                        </li>
                    );
                })}
            </ul>

            <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
        </>
    );
}
