'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useCustomProviderFunction } from '@gitroom/frontend/components/launches/helpers/use.custom.provider.function';
import { Select } from '@gitroom/react/form/select';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export const DiscordChannelSelect: FC<{
  name: string;
  onChange: (event: {
    target: {
      value: string;
      name: string;
    };
  }) => void;
  onChannelChange?: (channel: { id: string; isForum?: boolean } | undefined) => void;
}> = (props) => {
  const { onChange, name, onChannelChange } = props;
  const t = useT();
  const customFunc = useCustomProviderFunction();
  const [publications, setOrgs] = useState([]);
  const { getValues } = useSettings();
  const [currentMedia, setCurrentMedia] = useState<string | undefined>();

  // Lets the parent show the title field only when a forum is picked, since a
  // forum post is a thread and a thread needs a name.
  const report = useCallback(
    (list: any[], id: string | undefined) => {
      onChannelChange?.(list.find((p: any) => String(p.id) === String(id)));
    },
    [onChannelChange]
  );

  const onChangeInner = (event: {
    target: {
      value: string;
      name: string;
    };
  }) => {
    setCurrentMedia(event.target.value);
    report(publications, event.target.value);
    onChange(event);
  };
  useEffect(() => {
    customFunc.get('channels').then((data) => {
      setOrgs(data);
      report(data, getValues()[props.name]);
    });
    const settings = getValues()[props.name];
    if (settings) {
      setCurrentMedia(settings);
    }
  }, []);
  if (!publications.length) {
    return null;
  }
  return (
    <Select
      name={name}
      label="Select Channel"
      onChange={onChangeInner}
      value={currentMedia}
    >
      <option value="">{t('select_1', '--Select--')}</option>
      {publications.map((publication: any) => (
        <option key={publication.id} value={publication.id}>
          {publication.name}
        </option>
      ))}
    </Select>
  );
};
