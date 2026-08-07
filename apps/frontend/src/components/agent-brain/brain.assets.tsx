'use client';

import { FC, useCallback, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import {
  BRAIN_ASSET_NOTE_MAX,
  BRAIN_ASSETS_MAX,
} from '@gitroom/nestjs-libraries/agent-brain/brain.registry';
import { BrainAsset } from '@gitroom/nestjs-libraries/agent-brain/brain.types';

const isImage = (asset: BrainAsset) =>
  (asset.mime || '').startsWith('image/') ||
  /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(asset.url);

const isVideo = (asset: BrainAsset) =>
  (asset.mime || '').startsWith('video/') || /\.(mp4|mov|webm)$/i.test(asset.url);

// The brand's files. Uploads go through the app's normal media pipeline, so they
// land wherever storage is configured — R2 in this deployment — rather than in a
// second bucket of their own.
export const BrainAssets: FC<{
  assets: BrainAsset[];
  onChange: (assets: BrainAsset[]) => void;
}> = ({ assets, onChange }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { backendUrl, uploadDirectory } = useVariables() as any;
  const picker = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState<BrainAsset[]>(assets);
  const [uploading, setUploading] = useState(false);

  const update = useCallback(
    (next: BrainAsset[]) => {
      setCurrent(next);
      onChange(next);
    },
    [onChange]
  );

  // A stored path is relative to the upload host; an absolute URL is already
  // wherever it lives.
  const resolve = useCallback(
    (url: string) =>
      /^https?:\/\//i.test(url)
        ? url
        : `${uploadDirectory || backendUrl || ''}${url}`,
    [backendUrl, uploadDirectory]
  );

  const upload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) {
        return;
      }

      setUploading(true);

      try {
        const added: BrainAsset[] = [];

        for (const file of Array.from(files)) {
          const form = new FormData();
          form.append('file', file);

          const response = await fetch('/media/upload-simple', {
            method: 'POST',
            body: form,
          });

          if (!response.ok) {
            toaster.show(
              `${file.name} ${t('brain_asset_failed', 'could not be uploaded')}`,
              'warning'
            );
            continue;
          }

          const saved = await response.json();
          added.push({
            id: makeId(10),
            name: file.name,
            url: saved.path,
            mime: file.type,
            note: '',
          });
        }

        if (added.length) {
          update([...current, ...added].slice(0, BRAIN_ASSETS_MAX));
        }
      } finally {
        setUploading(false);
      }
    },
    [current, fetch, t, toaster, update]
  );

  return (
    <div className="flex flex-col gap-[12px]">
      {!!current.length && (
        <div className="flex flex-col gap-[10px]">
          {current.map((asset) => (
            <div
              key={asset.id}
              className="flex gap-[12px] rounded-[10px] border border-newTableBorder p-[10px] focus-within:border-warm transition-colors"
            >
              <div className="shrink-0 w-[72px] h-[72px] rounded-[8px] overflow-hidden bg-newBgColor flex items-center justify-center">
                {isImage(asset) ? (
                  <img
                    src={resolve(asset.url)}
                    alt={asset.name}
                    className="w-full h-full object-cover"
                  />
                ) : isVideo(asset) ? (
                  <video
                    src={resolve(asset.url)}
                    className="w-full h-full object-cover"
                    muted
                  />
                ) : (
                  <span className="text-[10px] text-textItemBlur px-[4px] text-center break-all">
                    {asset.name.split('.').pop()}
                  </span>
                )}
              </div>

              <div className="flex-1 min-w-0 flex flex-col gap-[4px]">
                <div className="flex items-center gap-[8px]">
                  <a
                    href={resolve(asset.url)}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 text-[13px] truncate hover:text-warm"
                  >
                    {asset.name}
                  </a>
                  <span
                    onClick={() =>
                      update(current.filter((one) => one.id !== asset.id))
                    }
                    data-tooltip-id="tooltip"
                    data-tooltip-content={t('brain_asset_remove', 'Remove')}
                    className="cursor-pointer select-none text-textItemBlur hover:text-warm"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="13"
                      height="13"
                      viewBox="0 0 16 16"
                      fill="none"
                    >
                      <path
                        d="M12 4L4 12M4 4L12 12"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </div>
                <textarea
                  value={asset.note || ''}
                  maxLength={BRAIN_ASSET_NOTE_MAX}
                  rows={2}
                  onChange={(event) =>
                    update(
                      current.map((one) =>
                        one.id === asset.id
                          ? { ...one, note: event.target.value }
                          : one
                      )
                    )
                  }
                  placeholder={t(
                    'brain_asset_note_placeholder',
                    'When should the agent use this, and when should it not?'
                  )}
                  className="w-full bg-transparent outline-none resize-none text-[13px] text-textItemBlur placeholder:text-textItemBlur"
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {current.length < BRAIN_ASSETS_MAX && (
        <>
          <input
            ref={picker}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              upload(event.target.files);
              event.target.value = '';
            }}
          />
          <div
            onClick={() => !uploading && picker.current?.click()}
            className="self-start cursor-pointer select-none flex items-center gap-[8px] rounded-[8px] border border-dashed border-newTableBorder px-[14px] h-[38px] text-[14px] text-textItemBlur hover:border-warm hover:text-warm hover:bg-warmHover transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M8 3.33333V12.6667M3.33333 8H12.6667"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {uploading
              ? t('brain_asset_uploading', 'Uploading...')
              : t('brain_asset_add', 'Add a file')}
          </div>
        </>
      )}
    </div>
  );
};
