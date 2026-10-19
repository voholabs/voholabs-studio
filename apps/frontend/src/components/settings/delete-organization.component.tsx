'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';

const useOrganizations = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return await (await fetch('/user/organizations')).json();
  }, []);
  return useSWR('organizations', load, {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
    revalidateOnReconnect: false,
  });
};

const ConfirmDeleteOrganization: FC<{
  name: string;
  close: () => void;
  onConfirm: () => void;
}> = ({ name, close, onConfirm }) => {
  const t = useT();
  const [typed, setTyped] = useState('');

  return (
    <div className="flex flex-col gap-[16px] max-w-[600px]">
      <div>
        {t(
          'delete_organization_warning',
          'Deleting "{{name}}" cannot be undone. This will:',
          { name }
        )}
      </div>
      <ul className="list-disc ps-[20px] text-[14px] flex flex-col gap-[4px]">
        <li>
          {t(
            'delete_organization_warning_channels',
            'Disconnect and delete all of its channels'
          )}
        </li>
        <li>
          {t(
            'delete_organization_warning_data',
            'Delete all of its posts, media and data'
          )}
        </li>
        <li>
          {t(
            'delete_organization_warning_subscription',
            'Cancel its subscription'
          )}
        </li>
      </ul>
      <div className="flex flex-col gap-[8px]">
        <div className="text-[14px]">
          {t(
            'delete_organization_type_name',
            'Type "{{name}}" to confirm',
            { name }
          )}
        </div>
        <input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={name}
          className="bg-newBgColorInner border border-newBorder rounded-[8px] px-[16px] h-[44px] text-textColor outline-none"
        />
      </div>
      <div className="flex gap-[12px]">
        <Button
          className="!bg-red-800"
          disabled={typed.trim() !== name.trim()}
          onClick={() => {
            close();
            onConfirm();
          }}
        >
          {t('yes_delete_organization', 'Yes, delete this organization')}
        </Button>
        <Button onClick={close}>{t('no_cancel', 'No, cancel!')}</Button>
      </div>
    </div>
  );
};

const DeleteOrganizationComponent: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const user = useUser();
  const modals = useModals();
  const { data } = useOrganizations();
  const [loading, setLoading] = useState(false);

  const current = data?.find((org: any) => org.id === user?.orgId);

  const deleteOrganization = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/user/delete-organization', {
        method: 'POST',
      });

      if (response.status !== 200 && response.status !== 201) {
        const { message } = await response.json().catch(() => ({
          message: '',
        }));
        toaster.show(
          message ||
            t(
              'could_not_delete_organization',
              'Could not delete this organization'
            ),
          'warning'
        );
        return;
      }

      window.location.href = '/';
    } finally {
      setLoading(false);
    }
  }, []);

  const openConfirm = useCallback(() => {
    modals.openModal({
      title: t('delete_organization', 'Delete Organization'),
      destructive: true,
      withCloseButton: true,
      children: (close) => (
        <ConfirmDeleteOrganization
          name={current.name}
          close={close}
          onConfirm={deleteOrganization}
        />
      ),
    });
  }, [current?.name, deleteOrganization]);

  // Only the super admin can delete an organization, and never their only one
  if (
    user?.impersonate ||
    user?.role !== 'SUPERADMIN' ||
    !current ||
    data.length < 2
  ) {
    return null;
  }

  return (
    <div className="my-[16px] mt-[16px] bg-sixth border-fifth border rounded-[4px] p-[24px] flex flex-col gap-[24px]">
      <div className="mt-[4px]">
        {t('delete_organization', 'Delete Organization')}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('delete_organization_name', 'Delete "{{name}}"', {
              name: current.name,
            })}
          </div>
          <div className="text-[12px] text-textItemBlur">
            {t(
              'delete_organization_description',
              'Its channels, posts and data are deleted and its subscription is cancelled. Your account and your other organizations stay.'
            )}
          </div>
        </div>
        <Button
          className="!bg-red-800"
          loading={loading}
          onClick={openConfirm}
        >
          {t('delete_organization', 'Delete Organization')}
        </Button>
      </div>
    </div>
  );
};

export default DeleteOrganizationComponent;
