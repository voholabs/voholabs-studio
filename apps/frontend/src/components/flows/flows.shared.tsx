'use client';

import { FC, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  useSharedFlow,
  useUserFlowActions,
} from '@gitroom/frontend/components/flows/flows.hooks';
import { flowCategoryLabel } from '@gitroom/frontend/components/flows/flows.card';
import { useShowFlowWarnings } from '@gitroom/frontend/components/flows/flows.editor';

// The page a flow's share link opens: what the flow does, its method as it
// would be imported (the author's colour codes, media links and the Studio
// name already taken out, and a note of what was), and the import. Importing
// needs Plus; the refusal opens the Plus dialog.
export const FlowsSharedPage: FC<{ token: string }> = ({ token }) => {
  const t = useT();
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data, isLoading, error } = useSharedFlow(token);
  const actions = useUserFlowActions();
  const showWarnings = useShowFlowWarnings();
  const [importing, setImporting] = useState(false);

  const importFlow = async () => {
    if (importing) {
      return;
    }
    setImporting(true);
    const saved = await actions.importShared(token);
    setImporting(false);
    if (saved) {
      showWarnings(saved);
      await mutate('user-flows');
      router.push('/flows');
    }
  };

  if (isLoading && !data) {
    return <LoadingComponent />;
  }

  return (
    <div className="bg-newBgColorInner flex-1 relative min-w-0">
      <div className="absolute inset-0 overflow-y-auto p-[20px]">
        {error || !data ? (
          <div className="text-[14px] text-textItemBlur py-[40px] text-center">
            {t(
              'flows_shared_gone',
              'This share link was turned off or never existed.'
            )}
          </div>
        ) : (
          <div className="max-w-[760px] mx-auto flex flex-col gap-[20px]">
            <div className="flex flex-col gap-[8px]">
              <div className="text-[12px] font-[500] uppercase tracking-[0.08em] text-textItemBlur">
                {t('flows_shared_kicker', 'A flow shared with you')}
              </div>
              <h1 className="text-[26px] font-[700] leading-[1.2] break-words">
                {data.flow.title}
              </h1>
              {!!data.flow.summary && (
                <div className="text-[15px] leading-[1.6] text-textItemBlur whitespace-pre-line">
                  {data.flow.summary}
                </div>
              )}
              <div className="flex items-center gap-[8px] flex-wrap text-[13px]">
                {!!data.flow.category && (
                  <span className="inline-flex items-center h-[22px] px-[10px] rounded-full text-[12px] font-[600] bg-tealSoft text-tealText">
                    {flowCategoryLabel(t, data.flow.category)}
                  </span>
                )}
                {!!data.flow.whenToUse && (
                  <span className="text-textItemBlur">{data.flow.whenToUse}</span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-[8px] rounded-[10px] border border-newTableBorder p-[16px]">
              <button
                type="button"
                onClick={importFlow}
                disabled={importing}
                className="self-start h-[42px] px-[22px] rounded-[8px] bg-btnPrimary hover:brightness-110 text-white text-[15px] font-[600] disabled:opacity-50 transition-all"
              >
                {importing
                  ? t('flows_shared_importing', 'Importing...')
                  : t('flows_shared_import', 'Import to my flows')}
              </button>
              <div className="text-[13px] leading-[1.5] text-textItemBlur">
                {t(
                  'flows_shared_brand_note',
                  'Only the method is imported. When it runs, your agent uses your own brand from your brief.'
                )}
              </div>
              {!!data.warnings.length && (
                <div className="flex flex-col gap-[4px] rounded-[8px] bg-warmSoft px-[12px] py-[10px] text-[13px] leading-[1.5]">
                  <div className="font-[600] text-warm">
                    {t(
                      'flows_shared_scrubbed',
                      "Taken out of the author's version:"
                    )}
                  </div>
                  <ul className="list-disc ps-[18px]">
                    {data.warnings.map((one) => (
                      <li key={one}>{one}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-[8px]">
              <div className="text-[12px] font-[500] uppercase tracking-[0.08em] text-textItemBlur">
                {t('flows_shared_method', 'The method')}
              </div>
              <div
                dir="auto"
                className="rounded-[8px] bg-newBgColor p-[14px] font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words"
              >
                {data.flow.body}
              </div>
              {Object.entries(data.flow.parts || {}).map(([name, text]) => (
                <details
                  key={name}
                  className="rounded-[8px] border border-newTableBorder"
                >
                  <summary className="cursor-pointer select-none px-[12px] h-[38px] flex items-center text-[13px] font-[600]">
                    {name}
                  </summary>
                  <div
                    dir="auto"
                    className="mx-[12px] mb-[12px] rounded-[6px] bg-newBgColor p-[12px] font-mono text-[12px] leading-[1.6] whitespace-pre-wrap break-words"
                  >
                    {text}
                  </div>
                </details>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
