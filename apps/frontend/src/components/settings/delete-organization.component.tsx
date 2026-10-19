'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

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

const DeleteOrganizationComponent: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const user = useUser();
  const { data } = useOrganizations();
  const [loading, setLoading] = useState(false);

  const current = data?.find((org: any) => org.id === user?.orgId);

  const deleteOrganization = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'delete_organization_confirm',
          'This organization, its channels and posts will be deleted. This action cannot be undone, are you sure?'
        ),
        t('yes_delete_organization', 'Yes, delete this organization')
      ))
    ) {
      return;
    }

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
              'This organization and its channels will be deleted permanently. Your account and your other organizations stay.'
            )}
          </div>
        </div>
        <Button
          className="!bg-red-800"
          loading={loading}
          onClick={deleteOrganization}
        >
          {t('delete_organization', 'Delete Organization')}
        </Button>
      </div>
    </div>
  );
};

export default DeleteOrganizationComponent;
