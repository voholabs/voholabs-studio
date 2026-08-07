'use client';
import { FC, ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';
import Link from 'next/link';

export const MenuItem: FC<{
  label: string;
  icon: ReactNode;
  path: string;
  onClick?: () => void;
  comingSoon?: boolean;
}> = ({ label, icon, path, onClick, comingSoon }) => {
  const currentPath = usePathname();
  const isActive = currentPath.indexOf(path) === 0;

  const className = clsx(
    'group w-full minCustom:h-[54px] custom:h-[44px] py-[8px] px-[6px] minCustom:gap-[4px] custom:gap-[2px] flex flex-col font-[600] items-center justify-center rounded-[12px] transition-colors',
    comingSoon
      ? 'text-textItemBlur opacity-70 grayscale cursor-default pointer-events-none'
      : clsx(
          'hover:text-textItemFocused hover:bg-boxFocused',
          isActive ? 'text-textItemFocused bg-boxFocused' : 'text-textItemBlur'
        )
  );

  const inner = (
    <>
      <div className="custom:scale-90 transition-transform">{icon}</div>
      <div className="custom:text-[9px] minCustom:text-[10px] leading-[1.1] text-center">
        {label}
      </div>
    </>
  );

  if (comingSoon) {
    return (
      <div title={label} aria-disabled="true" className={className}>
        {inner}
      </div>
    );
  }

  if (onClick) {
    return (
      <button onClick={onClick} title={label} className={className}>
        {inner}
      </button>
    );
  }

  return (
    <Link
      prefetch={true}
      href={path}
      title={label}
      {...path.indexOf('http') === 0 && { target: '_blank' }}
      className={className}
    >
      {inner}
    </Link>
  );
};
