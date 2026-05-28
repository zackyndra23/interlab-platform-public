'use client';

import * as React from 'react';
import { Download, X } from 'lucide-react';

import { api } from '@/lib/api';
import { IconButton } from './IconButton';
import type { UploadedFile } from './MultiFileUpload';

/**
 * Inline previewer for PDFs + images. Everything else falls back to a
 * "download" affordance. Presigned URL fetched on open so the URL never
 * leaks into React state serialisation.
 */
export function FilePreviewModal({
    file, onClose,
}: {
    file: UploadedFile | null;
    onClose: () => void;
}) {
    const [url, setUrl] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);

    React.useEffect(() => {
        if (!file) { setUrl(null); return; }
        setLoading(true);
        api.get(`/api/files/${file.id}/presigned-url`)
            .then((res) => setUrl(res.data?.data?.url || null))
            .catch(() => setUrl(null))
            .finally(() => setLoading(false));
    }, [file]);

    if (!file) return null;
    const mime = file.mime_type || '';
    const isPdf = mime.includes('pdf');
    const isImage = mime.startsWith('image/');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div aria-hidden onClick={onClose} className="absolute inset-0 bg-black/50" />
            <div className="relative z-10 flex h-[80vh] w-[90vw] max-w-4xl flex-col overflow-hidden rounded-lg border bg-card shadow-lg">
                <div className="flex items-center justify-between border-b border-border px-4 py-2">
                    <div className="min-w-0 flex-1 truncate text-sm font-medium">
                        {file.original_filename}
                    </div>
                    <div className="flex items-center gap-1">
                        {url && (
                            <IconButton
                                icon={Download}
                                tooltip="Download"
                                onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                            />
                        )}
                        <IconButton icon={X} tooltip="Close" onClick={onClose} />
                    </div>
                </div>
                <div className="flex-1 overflow-hidden bg-muted">
                    {loading && (
                        <p className="p-6 text-center text-sm text-muted-foreground">Loading…</p>
                    )}
                    {!loading && !url && (
                        <p className="p-6 text-center text-sm text-muted-foreground">
                            Preview unavailable. Try downloading instead.
                        </p>
                    )}
                    {!loading && url && isPdf && (
                        /* eslint-disable-next-line jsx-a11y/iframe-has-title */
                        <iframe src={url} className="h-full w-full" />
                    )}
                    {!loading && url && isImage && (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={url} alt={file.original_filename} className="h-full w-full object-contain" />
                    )}
                    {!loading && url && !isPdf && !isImage && (
                        <p className="p-6 text-center text-sm text-muted-foreground">
                            This file type does not support inline preview.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
