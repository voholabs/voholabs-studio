'use client';

import { FC, useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { HERMES_SETTINGS_KEY } from '@gitroom/frontend/components/hermes/use.hermes.settings';

// Shown only while no agent is connected. Once saved, none of these values are
// readable again — the backend never sends the endpoint or the key back.
export const HermesSettings: FC<{ onClose: () => void }> = ({ onClose }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { mutate } = useSWRConfig();
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);

    try {
      const response = await fetch('/hermes', {
        method: 'PUT',
        body: JSON.stringify({ url, apiKey }),
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        toaster.show(
          detail?.message || t('hermes_save_failed', 'Could not save'),
          'warning'
        );
        return;
      }

      await mutate(HERMES_SETTINGS_KEY);
      toaster.show(t('hermes_saved', 'Agent connected'));
      onClose();
    } finally {
      setSaving(false);
    }
  }, [apiKey, fetch, mutate, onClose, t, toaster, url]);

  const field =
    'h-[42px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newTableBorder outline-none focus:border-warm transition-colors text-[14px]';

  return (
    <div className="flex flex-col gap-[16px] w-[520px] max-w-full">
      <div className="text-[13px] text-textItemBlur">
        {t(
          'hermes_scope_hint',
          'One agent for this team. Everyone in it talks to the same one.'
        )}
      </div>

      <div className="flex flex-col gap-[4px]">
        <div className="text-[14px]">{t('hermes_endpoint', 'Endpoint')}</div>
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://your-hermes/v1"
          className={field}
        />
        <div className="text-[12px] text-textItemBlur">
          {t(
            'hermes_endpoint_hint',
            'The base URL of the OpenAI-compatible API, or the full chat completions URL.'
          )}
        </div>
      </div>

      <div className="flex flex-col gap-[4px]">
        <div className="text-[14px]">{t('hermes_api_key', 'API key')}</div>
        <input
          value={apiKey}
          type="password"
          autoComplete="off"
          onChange={(event) => setApiKey(event.target.value)}
          placeholder={t('hermes_key_empty', 'Bearer token')}
          className={field}
        />
        <div className="text-[12px] text-textItemBlur">
          {t(
            'hermes_api_key_hint',
            'Kept encrypted on the server. It is never sent back to the browser, so it cannot be read again once saved.'
          )}
        </div>
      </div>

      <div className="flex justify-end gap-[10px]">
        <Button secondary onClick={onClose} disabled={saving}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button
          onClick={save}
          loading={saving}
          disabled={saving || !url || !apiKey}
        >
          {t('hermes_connect', 'Connect the agent')}
        </Button>
      </div>
    </div>
  );
};
