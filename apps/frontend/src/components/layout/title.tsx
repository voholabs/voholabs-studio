'use client';

import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import { useMenuItem } from '@gitroom/frontend/components/layout/top.menu';
import { TitleExtras } from '@gitroom/frontend/components/wallet-locks/title.extras';
export const Title = () => {
  const path = usePathname();
  const { all: menuItems } = useMenuItem();
  const current = useMemo(() => {
    return menuItems.find((item) => path.indexOf(item.path) > -1);
  }, [path]);

  if (!current?.titleInfo) {
    return <h1>{current?.name}</h1>;
  }

  return (
    <h1 className="flex items-center gap-[10px]">
      {current.name}
      <TitleExtras path={current.path} info={current.titleInfo} />
    </h1>
  );
};
